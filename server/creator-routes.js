// Rotas do painel do criador: insights, conteúdo, engajamento, monetização, anúncios,
// visualizações de publicações e partilhas. Registadas a partir de index.js.
const { groupAudience, impressionCost, parseAdInput } = require("./ads");
const { TARGETING_SURCHARGE, parseTargeting } = require("./growth");
const { POST_MUSIC_SQL } = require("./music-routes");
const {
  MIN_PAYOUT_KZ, PARTNER_RPM_KZ, PARTNER_RULES, partnerEarnings, partnerEligibility, pickPromotions
} = require("./promotions");

const PERIODS = [7, 28, 90];
const MAX_SHARE_GROUPS = 5;

// Depois de paga, a promoção fica em revisão: só vai para o ar quando um administrador a aprovar
// (o prazo começa a contar nessa altura). Usada pelo webhook da Stripe e pelo modo de demonstração.
async function activatePaidAd(db, adId, details = {}) {
  const result = await db.query(`
    UPDATE ads SET status='in_review', paid_at=NOW(), stripe_payment_intent=$2
    WHERE id=$1 AND status='pending_payment' RETURNING id`, [adId, details.paymentIntent || null]);
  return result.rowCount > 0;
}

function registerCreatorRoutes(app, deps) {
  const {
    pool, auth, optionalAuth, imageUpload, optimizeUpload, removeUpload, parseId,
    isRecord, cleanText, transaction, serializePost, blockedBetween, ACTIVE_SUBSCRIPTION_SQL, payments
  } = deps;

  // ---------------------------------------------------------------------------------------------
  // Visualizações: o feed envia, em lotes, as publicações que ficaram visíveis no ecrã.
  // ---------------------------------------------------------------------------------------------
  app.post("/api/posts/views", auth, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(parseId).filter(Boolean))].slice(0, 50) : [];
    if (!ids.length) return res.json({ recorded: 0 });
    // Só conta publicações de outras pessoas (ver a própria publicação não é uma visualização).
    const result = await pool.query(`
      INSERT INTO post_views(post_id,viewer_id)
      SELECT p.id,$1 FROM posts p WHERE p.id = ANY($2::int[]) AND p.user_id <> $1
      ON CONFLICT DO NOTHING`, [req.user.id, ids]);
    res.json({ recorded: result.rowCount });
  });

  // ---------------------------------------------------------------------------------------------
  // Partilhar: cria uma publicação nova no perfil, numa página própria e/ou em até 5 grupos.
  // ---------------------------------------------------------------------------------------------
  app.post("/api/posts/:id/share", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Publicação inválida." });
    const body = isRecord(req.body) ? req.body : {};
    const text = cleanText(body.body);
    if (text.length > 5000) return res.status(400).json({ error: "O texto pode ter até 5000 caracteres." });
    const toProfile = body.profile === true;
    const pageId = body.pageId === undefined || body.pageId === null || body.pageId === "" ? null : parseId(body.pageId);
    const rawGroups = Array.isArray(body.groupIds) ? body.groupIds : [];
    const groupIds = [...new Set(rawGroups.map(parseId))];
    if ((body.pageId && !pageId) || groupIds.some(groupId => !groupId)) return res.status(400).json({ error: "Destino inválido." });
    if (groupIds.length > MAX_SHARE_GROUPS) return res.status(400).json({ error: `Podes partilhar em até ${MAX_SHARE_GROUPS} grupos de cada vez.` });
    if (!toProfile && !pageId && !groupIds.length) return res.status(400).json({ error: "Escolhe onde queres partilhar." });

    // Partilhar uma partilha aponta sempre para a publicação original.
    const original = await pool.query(`
      SELECT COALESCE(o.id,p.id) AS id, COALESCE(o.user_id,p.user_id) AS user_id,
        COALESCE(o.is_exclusive,p.is_exclusive) AS is_exclusive, COALESCE(o.group_id,p.group_id) AS group_id,
        COALESCE(o.hidden_at,p.hidden_at) AS hidden_at
      FROM posts p LEFT JOIN posts o ON o.id=p.shared_post_id WHERE p.id=$1`, [id]);
    const source = original.rows[0];
    if (!source || source.hidden_at) return res.status(404).json({ error: "Publicação não encontrada." });
    const blocked = await pool.query(`SELECT ${blockedBetween("$1", "$2")} AS blocked`, [req.user.id, source.user_id]);
    if (blocked.rows[0].blocked) return res.status(404).json({ error: "Publicação não encontrada." });
    if (source.is_exclusive || source.group_id) {
      return res.status(403).json({ error: "Só é possível partilhar publicações públicas." });
    }
    if (pageId) {
      const page = await pool.query("SELECT 1 FROM pages WHERE id=$1 AND owner_id=$2", [pageId, req.user.id]);
      if (!page.rowCount) return res.status(403).json({ error: "Só podes partilhar em páginas que geres." });
    }
    if (groupIds.length) {
      const membership = await pool.query(
        "SELECT COUNT(*)::int AS count FROM group_members WHERE user_id=$1 AND group_id = ANY($2::int[])", [req.user.id, groupIds]);
      if (membership.rows[0].count !== groupIds.length) return res.status(403).json({ error: "Só podes partilhar em grupos a que pertences." });
    }

    const targets = [
      ...(toProfile ? [{ groupId: null, pageId: null }] : []),
      ...(pageId ? [{ groupId: null, pageId }] : []),
      ...groupIds.map(groupId => ({ groupId, pageId: null }))
    ];
    await transaction(async client => {
      for (const target of targets) {
        await client.query(
          `INSERT INTO posts(user_id,body,media_url,media_type,is_exclusive,group_id,page_id,shared_post_id)
           VALUES($1,$2,'','',FALSE,$3,$4,$5)`,
          [req.user.id, text, target.groupId, target.pageId, source.id]);
      }
      if (source.user_id !== req.user.id) {
        await client.query(`
          INSERT INTO notifications(user_id,actor_id,type,text)
          VALUES($1,$2,'share','Partilhou a tua publicação.')`, [source.user_id, req.user.id]);
      }
    });
    res.status(201).json({ shared: targets.length });
  });

  // ---------------------------------------------------------------------------------------------
  // Painel do criador
  // ---------------------------------------------------------------------------------------------

  // Séries diárias de 2×N dias: os últimos N são o período atual, os anteriores servem para comparar.
  app.get("/api/creator/overview", auth, async (req, res) => {
    const days = PERIODS.includes(Number(req.query.days)) ? Number(req.query.days) : 28;
    const id = req.user.id;
    const [series, profile, recent] = await Promise.all([
      pool.query(`
        WITH d AS (SELECT g::date AS day FROM generate_series(CURRENT_DATE - ($2::int * 2 - 1), CURRENT_DATE, INTERVAL '1 day') g)
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          (SELECT COUNT(*) FROM post_views v JOIN posts p ON p.id=v.post_id WHERE p.user_id=$1 AND v.viewed_on=d.day)::int AS views,
          ((SELECT COUNT(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=$1 AND l.user_id<>$1 AND l.created_at::date=d.day)
            + (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=$1 AND c.user_id<>$1 AND c.created_at::date=d.day)
            + (SELECT COUNT(*) FROM posts s JOIN posts p ON p.id=s.shared_post_id WHERE p.user_id=$1 AND s.user_id<>$1 AND s.created_at::date=d.day))::int AS engagement,
          (SELECT COUNT(*) FROM follows f WHERE f.following_id=$1 AND f.created_at::date=d.day)::int AS followers,
          (SELECT COUNT(DISTINCT pv.viewer_id) FROM profile_views pv WHERE pv.profile_id=$1 AND pv.viewed_on=d.day)::int AS visits
        FROM d ORDER BY d.day`, [id, days]),
      pool.query(`
        SELECT u.username,u.display_name,u.avatar_url,u.is_creator,u.suspended_at,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.hidden_at IS NOT NULL)::int AS hidden_posts,
          (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers
        FROM users u WHERE u.id=$1`, [id]),
      pool.query(`
        SELECT p.id,LEFT(p.body,140) AS excerpt,p.media_url,p.media_type,p.created_at,p.is_exclusive,p.group_id,p.shared_post_id,
          (SELECT COUNT(*) FROM post_views v WHERE v.post_id=p.id)::int AS views,
          p.like_count::int AS likes,
          p.comment_count::int AS comments,
          (SELECT COUNT(*) FROM posts s WHERE s.shared_post_id=p.id)::int AS shares
        FROM posts p WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 4`, [id])
    ]);
    const rows = series.rows;
    const current = rows.slice(days);
    const previous = rows.slice(0, days);
    const sum = (list, key) => list.reduce((total, row) => total + row[key], 0);
    const metrics = Object.fromEntries(["views", "engagement", "followers", "visits"].map(key => [key, { total: sum(current, key), previous: sum(previous, key) }]));
    res.json({ days, metrics, daily: current, profile: profile.rows[0], recent: recent.rows.map(serializePost) });
  });

  app.get("/api/creator/content", auth, async (req, res) => {
    const before = req.query.before === undefined ? null : parseId(req.query.before);
    if (req.query.before !== undefined && !before) return res.status(400).json({ error: "Filtro inválido." });
    const limit = 20;
    const result = await pool.query(`
      SELECT p.id,LEFT(p.body,180) AS excerpt,p.media_url,p.media_type,p.created_at,p.is_exclusive,p.group_id,p.page_id,p.shared_post_id,p.hidden_at,
        g.name AS group_name, pg.name AS page_name,
        (SELECT COUNT(*) FROM post_views v WHERE v.post_id=p.id)::int AS views,
        p.like_count::int AS likes,
        p.comment_count::int AS comments,
        (SELECT COUNT(*) FROM posts s WHERE s.shared_post_id=p.id)::int AS shares
      FROM posts p LEFT JOIN social_groups g ON g.id=p.group_id LEFT JOIN pages pg ON pg.id=p.page_id
      WHERE p.user_id=$1 AND ($2::int IS NULL OR p.id < $2)
      ORDER BY p.id DESC LIMIT ${limit}`, [req.user.id, before]);
    res.json({ posts: result.rows.map(serializePost), nextCursor: result.rows.length === limit ? result.rows[result.rows.length - 1].id : null });
  });

  app.get("/api/creator/engagement", auth, async (req, res) => {
    const id = req.user.id;
    const [comments, likes, followers] = await Promise.all([
      pool.query(`
        SELECT c.id,c.body,c.created_at,c.post_id,LEFT(p.body,80) AS post_excerpt,u.username,u.display_name,u.avatar_url
        FROM comments c JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=c.user_id
        WHERE p.user_id=$1 AND c.user_id<>$1 ORDER BY c.created_at DESC LIMIT 20`, [id]),
      pool.query(`
        SELECT l.post_id,l.created_at,LEFT(p.body,80) AS post_excerpt,u.username,u.display_name,u.avatar_url
        FROM likes l JOIN posts p ON p.id=l.post_id JOIN users u ON u.id=l.user_id
        WHERE p.user_id=$1 AND l.user_id<>$1 ORDER BY l.created_at DESC NULLS LAST LIMIT 20`, [id]),
      pool.query(`
        SELECT f.created_at,u.username,u.display_name,u.avatar_url
        FROM follows f JOIN users u ON u.id=f.follower_id
        WHERE f.following_id=$1 ORDER BY f.created_at DESC NULLS LAST LIMIT 20`, [id])
    ]);
    res.json({ comments: comments.rows, likes: likes.rows, followers: followers.rows });
  });

  app.get("/api/creator/monetization", auth, async (req, res) => {
    const id = req.user.id;
    const [creator, subscribers, ads] = await Promise.all([
      pool.query(`
        SELECT u.is_creator,u.subscription_price,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL})::int AS active_subscribers,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL} AND s.provider='stripe')::int AS paying_subscribers,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL} AND s.cancel_at_period_end)::int AS canceling_subscribers,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.is_exclusive)::int AS exclusive_posts
        FROM users u WHERE u.id=$1`, [id]),
      pool.query(`
        SELECT s.status,s.provider,s.cancel_at_period_end,s.current_period_end,s.created_at,u.username,u.display_name,u.avatar_url,
          (${ACTIVE_SUBSCRIPTION_SQL}) AS is_active
        FROM subscriptions s JOIN users u ON u.id=s.subscriber_id
        WHERE s.creator_id=$1 ORDER BY s.created_at DESC LIMIT 50`, [id]),
      pool.query("SELECT COALESCE(SUM(spent),0)::float AS spent, COUNT(*) FILTER (WHERE status='active')::int AS active FROM ads WHERE owner_id=$1", [id])
    ]);
    const row = creator.rows[0];
    const price = Number(row.subscription_price) || 0;
    res.json({
      is_creator: row.is_creator,
      price,
      active_subscribers: row.active_subscribers,
      paying_subscribers: row.paying_subscribers,
      canceling_subscribers: row.canceling_subscribers,
      exclusive_posts: row.exclusive_posts,
      // Estimativa bruta: assinantes pagos × preço atual (antes de taxas e impostos).
      estimated_monthly_revenue: Math.round(row.paying_subscribers * price * 100) / 100,
      subscribers: subscribers.rows,
      ads: ads.rows[0]
    });
  });

  // Ativar o modo criador depois do registo (o preço define-se depois em Definições).
  app.post("/api/creator/enable", auth, async (req, res) => {
    const result = await pool.query("UPDATE users SET is_creator=TRUE WHERE id=$1 RETURNING id", [req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    res.json({ is_creator: true });
  });

  // ---------------------------------------------------------------------------------------------
  // Programa de Parceiros Biva: o Biva paga aos criadores que cumprem as regras.
  // ---------------------------------------------------------------------------------------------
  const partnerStatus = async userId => {
    const account = await pool.query(`
      SELECT u.partner_since,u.suspended_at,u.email_verified,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
        (SELECT COUNT(*) FROM post_views v JOIN posts p ON p.id=v.post_id
          WHERE p.user_id=u.id AND v.viewed_on > CURRENT_DATE - $2::int)::int AS views
      FROM users u WHERE u.id=$1`, [userId, PARTNER_RULES.viewsWindowDays]);
    const row = account.rows[0];
    if (!row) return null;
    const eligibility = partnerEligibility({ followers: row.followers, views: row.views, suspended: Boolean(row.suspended_at), emailVerified: row.email_verified });
    return { row, eligibility };
  };

  app.get("/api/creator/partner", auth, async (req, res) => {
    const status = await partnerStatus(req.user.id);
    if (!status) return res.status(404).json({ error: "Conta não encontrada." });
    const { row, eligibility } = status;
    let months = [];
    if (row.partner_since) {
      // Visualizações qualificadas por mês, desde a adesão (as próprias nunca contam: ver /api/posts/views).
      const result = await pool.query(`
        SELECT to_char(date_trunc('month', v.viewed_on), 'YYYY-MM') AS month, COUNT(*)::int AS views
        FROM post_views v JOIN posts p ON p.id=v.post_id
        WHERE p.user_id=$1 AND v.viewed_on >= $2::date
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [req.user.id, row.partner_since]);
      months = result.rows.map(month => ({ ...month, amount: partnerEarnings(month.views) }));
    }
    res.json({
      rules: PARTNER_RULES,
      rpm: PARTNER_RPM_KZ,
      min_payout: MIN_PAYOUT_KZ,
      eligible: eligibility.eligible,
      checks: eligibility.checks,
      partner_since: row.partner_since,
      // Enquanto deixar de cumprir as regras, os ganhos ficam em pausa.
      earning: Boolean(row.partner_since) && eligibility.eligible,
      months
    });
  });

  app.post("/api/creator/partner/join", auth, async (req, res) => {
    const status = await partnerStatus(req.user.id);
    if (!status) return res.status(404).json({ error: "Conta não encontrada." });
    if (!status.eligibility.eligible) {
      const missing = status.eligibility.checks.filter(check => !check.met).map(check => check.label.toLowerCase());
      return res.status(403).json({ error: `Ainda não cumpres as regras do programa: ${missing.join(", ")}.` });
    }
    await pool.query("UPDATE users SET partner_since=COALESCE(partner_since,NOW()), is_creator=TRUE WHERE id=$1", [req.user.id]);
    res.json({ joined: true });
  });

  // ---------------------------------------------------------------------------------------------
  // Anúncios e publicações impulsionadas: só ficam ativos depois de pagos, e a partir daí o Biva
  // mostra-os sozinho (ver pickPromotions em promotions.js).
  // ---------------------------------------------------------------------------------------------
  const AD_FIELDS = `a.id,a.post_id,a.title,a.body,a.link_url,a.image_url,a.budget::float AS budget,a.spent::float AS spent,
    a.status,a.days,a.starts_at,a.ends_at,a.paid_at,a.created_at,a.target_provinces,a.target_min_age,a.target_max_age,
    a.review_note,a.refund_status`;

  // Fecha promoções ativas que terminaram o prazo ou gastaram o orçamento.
  const endFinishedAds = () => pool.query(
    "UPDATE ads SET status='ended' WHERE status IN ('active','paused') AND (ends_at < NOW() OR spent >= budget)");

  // Abre o pagamento (Stripe, ou demonstração sem Stripe em desenvolvimento). Ver payments.js.
  const startAdPayment = (ad, ownerEmail, choice = {}) => payments.start({
    method: choice.method, phone: choice.phone,
    purpose: "ad", refId: ad.id, amountKz: ad.budget, userId: ad.owner_id, email: ownerEmail,
    name: ad.post_id ? `Impulsionar publicação no Biva (${ad.days} dias)` : `Anúncio no Biva: ${ad.title} (${ad.days} dias)`,
    successPath: "/creator/anuncios?pagamento=sucesso", cancelPath: "/creator/anuncios?pagamento=cancelado",
    onSession: sessionId => pool.query("UPDATE ads SET stripe_session_id=$2 WHERE id=$1", [ad.id, sessionId])
  });

  // Custo de uma impressão: as promoções segmentadas (província/idade) custam mais.
  const costFor = ad => Math.round(impressionCost() * (isTargeted(ad) ? 1 + TARGETING_SURCHARGE : 1) * 100) / 100;
  const isTargeted = ad => (ad.target_provinces?.length || 0) > 0 || ad.target_min_age !== null || ad.target_max_age !== null;

  // Condição SQL: a pessoa que vê ("viewer", pode não existir) encaixa no público da promoção.
  const AUDIENCE_SQL = `(cardinality(a.target_provinces)=0 OR viewer.province = ANY(a.target_provinces))
    AND (a.target_min_age IS NULL OR (viewer.birth_date IS NOT NULL AND date_part('year', age(viewer.birth_date)) >= a.target_min_age))
    AND (a.target_max_age IS NULL OR (viewer.birth_date IS NOT NULL AND date_part('year', age(viewer.birth_date)) <= a.target_max_age))`;

  app.get("/api/ads/mine", auth, async (req, res) => {
    await endFinishedAds();
    const result = await pool.query(`
      SELECT ${AD_FIELDS}, LEFT(p.body,120) AS post_excerpt, p.media_url AS post_media_url, p.media_type AS post_media_type,
        (SELECT COUNT(*) FROM ad_events e WHERE e.ad_id=a.id AND e.kind='impression')::int AS impressions,
        (SELECT COUNT(DISTINCT e.user_id) FROM ad_events e WHERE e.ad_id=a.id AND e.kind='impression')::int AS reach,
        (SELECT COUNT(*) FROM ad_events e WHERE e.ad_id=a.id AND e.kind='click')::int AS clicks
      FROM ads a LEFT JOIN posts p ON p.id=a.post_id
      WHERE a.owner_id=$1 ORDER BY a.created_at DESC`, [req.user.id]);
    res.json({ ads: result.rows, cost_per_impression: impressionCost(), targeting_surcharge: TARGETING_SURCHARGE, payments: payments.mode });
  });

  app.post("/api/ads", auth, imageUpload.single("image"), optimizeUpload("post"), async (req, res) => {
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
    const fail = async (status, error) => { await removeUpload(imageUrl); return res.status(status).json({ error }); };
    const input = isRecord(req.body) ? { ...req.body } : {};
    const user = await pool.query("SELECT username,email FROM users WHERE id=$1", [req.user.id]);
    const owner = user.rows[0];
    if (!owner) return fail(404, "Conta não encontrada.");

    // Impulsionar: a publicação tem de ser tua, pública e visível.
    let postId = null;
    if (input.postId !== undefined && input.postId !== "") {
      postId = parseId(input.postId);
      if (!postId) return fail(400, "Publicação inválida.");
      const post = await pool.query(
        "SELECT body,is_exclusive,group_id,hidden_at,shared_post_id FROM posts WHERE id=$1 AND user_id=$2", [postId, req.user.id]);
      const target = post.rows[0];
      if (!target) return fail(404, "Publicação não encontrada.");
      if (target.is_exclusive || target.group_id || target.hidden_at || target.shared_post_id) {
        return fail(400, "Só podes impulsionar publicações públicas tuas (não exclusivas, fora de grupos e que não sejam partilhas).");
      }
      if (!cleanText(input.title)) input.title = cleanText(target.body).slice(0, 80) || "Publicação impulsionada";
      input.destination = "profile";
    }

    const parsed = parseAdInput(input, owner.username);
    if (parsed.error) return fail(400, parsed.error);
    const audience = parseTargeting({ provinces: input.targetProvinces, minAge: input.targetMinAge, maxAge: input.targetMaxAge });
    if (audience.error) return fail(400, audience.error);
    const { title, body, linkUrl, budget, days } = parsed.ad;
    const { provinces, minAge, maxAge } = audience.targeting;
    const result = await pool.query(`
      INSERT INTO ads(owner_id,post_id,title,body,link_url,image_url,budget,days,status,ends_at,target_provinces,target_min_age,target_max_age)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending_payment',NOW() + ($8::int * INTERVAL '1 day'),$9,$10,$11)
      RETURNING id,owner_id,post_id,title,budget,days`,
    [req.user.id, postId, title, body, linkUrl, imageUrl, budget, days, provinces, minAge, maxAge]);
    const payment = await startAdPayment(result.rows[0], owner.email, { method: input.method, phone: input.phone });
    if (payment.error) return res.status(503).json({ id: result.rows[0].id, error: payment.error });
    res.status(201).json({ id: result.rows[0].id, ...payment });
  });

  // Voltar a abrir o pagamento de uma promoção que ficou por pagar.
  app.post("/api/ads/:id/checkout", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Anúncio inválido." });
    const result = await pool.query(
      `SELECT a.id,a.owner_id,a.post_id,a.title,a.budget,a.days,u.email FROM ads a JOIN users u ON u.id=a.owner_id
       WHERE a.id=$1 AND a.owner_id=$2 AND a.status='pending_payment'`, [id, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Este anúncio já foi pago ou não existe." });
    const payment = await startAdPayment(result.rows[0], result.rows[0].email, { method: req.body?.method, phone: req.body?.phone });
    if (payment.error) return res.status(503).json({ error: payment.error });
    res.json(payment);
  });

  app.patch("/api/ads/:id", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const status = req.body?.status;
    if (!id || !["active", "paused"].includes(status)) return res.status(400).json({ error: "Pedido inválido." });
    await endFinishedAds();
    const result = await pool.query(
      "UPDATE ads SET status=$3 WHERE id=$1 AND owner_id=$2 AND status IN ('active','paused') RETURNING id",
      [id, req.user.id, status]);
    if (!result.rowCount) return res.status(409).json({ error: "Este anúncio já terminou, ainda não foi pago ou não existe." });
    res.json({ status });
  });

  app.delete("/api/ads/:id", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Anúncio inválido." });
    const result = await pool.query("DELETE FROM ads WHERE id=$1 AND owner_id=$2 RETURNING image_url", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Anúncio não encontrado." });
    await removeUpload(result.rows[0].image_url);
    res.json({ deleted: true });
  });

  // Resultados de uma promoção (só para quem a criou): números por dia, no máximo os últimos 30,
  // e público por província. Nunca diz quem viu ou clicou.
  app.get("/api/ads/:id/stats", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Anúncio inválido." });
    const owned = await pool.query("SELECT 1 FROM ads WHERE id=$1 AND owner_id=$2", [id, req.user.id]);
    if (!owned.rowCount) return res.status(404).json({ error: "Anúncio não encontrado." });
    const [daily, provinces] = await Promise.all([
      pool.query(`
        WITH span AS (SELECT starts_at::date AS first, LEAST(ends_at::date, CURRENT_DATE) AS last FROM ads WHERE id=$1),
          d AS (SELECT g::date AS day FROM span, generate_series(GREATEST(span.first, span.last - 29), span.last, INTERVAL '1 day') g)
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          COUNT(e.kind) FILTER (WHERE e.kind='impression')::int AS impressions,
          COUNT(e.kind) FILTER (WHERE e.kind='click')::int AS clicks
        FROM d LEFT JOIN ad_events e ON e.ad_id=$1 AND e.day=d.day
        GROUP BY d.day ORDER BY d.day`, [id]),
      pool.query(`
        SELECT NULLIF(u.province, '') AS province, COUNT(DISTINCT e.user_id)::int AS people
        FROM ad_events e JOIN users u ON u.id=e.user_id
        WHERE e.ad_id=$1 AND e.kind='impression' GROUP BY 1`, [id])
    ]);
    res.json({ daily: daily.rows, provinces: groupAudience(provinces.rows) });
  });

  // Condição SQL partilhada: promoção paga, ativa, dentro do prazo e com orçamento.
  const SERVABLE_AD_SQL = "a.status='active' AND a.paid_at IS NOT NULL AND NOW() BETWEEN a.starts_at AND a.ends_at AND a.spent < a.budget";

  // Espaço "Patrocinado" da coluna direita: anúncios sem publicação associada.
  app.get("/api/ads/serve", optionalAuth, async (req, res) => {
    await endFinishedAds();
    const viewer = req.user?.id || 0;
    const result = await pool.query(`
      SELECT a.id,a.title,a.body,a.link_url,a.image_url,a.budget,a.spent,a.ends_at,u.display_name AS advertiser
      FROM ads a JOIN users u ON u.id=a.owner_id LEFT JOIN users viewer ON viewer.id=$1
      WHERE ${SERVABLE_AD_SQL} AND a.post_id IS NULL AND ${AUDIENCE_SQL} AND NOT ${blockedBetween("$1", "a.owner_id")}
      LIMIT 200`, [viewer]);
    const [ad] = pickPromotions(result.rows, 1);
    if (!ad) return res.json({ ad: null });
    const { budget: _budget, spent: _spent, ends_at: _ends, ...publicAd } = ad;
    res.json({ ad: publicAd });
  });

  // Publicações impulsionadas para misturar no feed (nunca as tuas nem de quem bloqueaste).
  // placement: feed (qualquer publicação), reels (só vídeos) ou stories (só com imagem ou vídeo).
  app.get("/api/ads/feed", optionalAuth, async (req, res) => {
    await endFinishedAds();
    const viewer = req.user?.id || 0;
    const placement = ["feed", "reels", "stories"].includes(req.query.placement) ? req.query.placement : "feed";
    const mediaFilter = placement === "reels" ? "AND p.media_type='video'" : placement === "stories" ? "AND p.media_url <> ''" : "";
    const candidates = await pool.query(`
      SELECT a.id,a.post_id,a.budget,a.spent,a.ends_at
      FROM ads a JOIN posts p ON p.id=a.post_id LEFT JOIN users viewer ON viewer.id=$1
      WHERE ${SERVABLE_AD_SQL} AND a.owner_id <> $1 AND p.hidden_at IS NULL AND NOT p.is_exclusive AND p.group_id IS NULL
        ${mediaFilter} AND ${AUDIENCE_SQL} AND NOT ${blockedBetween("$1", "a.owner_id")}
      LIMIT 200`, [viewer]);
    const picked = pickPromotions(candidates.rows, placement === "stories" ? 1 : 2);
    if (!picked.length) return res.json({ posts: [] });
    const posts = await pool.query(`
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_creator, u.partner_since IS NOT NULL AS is_verified,
        p.star_count::int AS stars,
        p.like_count AS likes,
        EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
        p.comment_count AS comments,
        p.share_count AS shares,
        ${POST_MUSIC_SQL}
      FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id = ANY($2::int[])`, [viewer, picked.map(ad => ad.post_id)]);
    const byId = new Map(posts.rows.map(post => [post.id, post]));
    res.json({
      posts: picked.filter(ad => byId.has(ad.post_id)).map(ad => ({ ...serializePost(byId.get(ad.post_id)), sponsored: { ad_id: ad.id } }))
    });
  });

  // A impressão só é contada (e cobrada) quando a promoção aparece mesmo no ecrã,
  // no máximo uma vez por pessoa e por dia. Quem anuncia não paga as próprias visualizações.
  app.post("/api/ads/:id/impression", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Anúncio inválido." });
    const charged = await transaction(async client => {
      const ad = await client.query(`SELECT a.owner_id,a.target_provinces,a.target_min_age,a.target_max_age FROM ads a WHERE a.id=$1 AND ${SERVABLE_AD_SQL} FOR UPDATE`, [id]);
      if (!ad.rowCount || ad.rows[0].owner_id === req.user.id) return false;
      const counted = await client.query(
        "INSERT INTO ad_events(ad_id,user_id,kind) VALUES($1,$2,'impression') ON CONFLICT DO NOTHING", [id, req.user.id]);
      if (!counted.rowCount) return false;
      await client.query(`
        UPDATE ads SET spent = LEAST(budget, spent + $2),
          status = CASE WHEN spent + $2 >= budget THEN 'ended' ELSE status END
        WHERE id=$1`, [id, costFor(ad.rows[0])]);
      return true;
    });
    res.json({ counted: charged });
  });

  app.post("/api/ads/:id/click", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Anúncio inválido." });
    const ad = await pool.query("SELECT link_url,owner_id FROM ads WHERE id=$1", [id]);
    if (!ad.rowCount) return res.status(404).json({ error: "Anúncio não encontrado." });
    if (req.user && req.user.id !== ad.rows[0].owner_id) {
      await pool.query("INSERT INTO ad_events(ad_id,user_id,kind) VALUES($1,$2,'click') ON CONFLICT DO NOTHING", [id, req.user.id]);
    }
    res.json({ url: ad.rows[0].link_url });
  });
}

module.exports = { MAX_SHARE_GROUPS, activatePaidAd, registerCreatorRoutes };
