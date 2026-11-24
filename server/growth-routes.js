// Rotas de crescimento e monetização: Estrelas Tchilar, convites, marketplace de marcas,
// desafios mensais e dados de público (província/idade). Registadas a partir de index.js.
const {
  ANGOLA_PROVINCES, GIFT_AMOUNTS, MAX_CAMPAIGN_KZ, MIN_CAMPAIGN_KZ, REFERRAL_BONUS_STARS, STAR_PACKS, STAR_PRICE_KZ,
  campaignSplit, packPrice, parseBirthDate, referralQualifies, starsValueKz
} = require("./growth");
const { LEVELS, hasCash, parsePrizes } = require("./challenge-templates");
const { VERIFICATION_MIN_FOLLOWERS, VERIFICATION_PLANS, verificationEligibility } = require("./verification");

// Saldo de estrelas para gastar: compras, prémios e bónus menos as ofertas feitas.
// As estrelas RECEBIDAS não entram aqui: valem dinheiro (80%) e vão para os ganhos (ver finance-routes.js).
const balanceSql = "SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS balance FROM star_ledger WHERE user_id=$1";

function registerGrowthRoutes(app, deps) {
  const {
    pool, auth, optionalAuth, requireAdmin, parseId, isRecord, cleanText, transaction,
    blockedBetween, canAccessPost, payments
  } = deps;

  const notify = (db, userId, actorId, type, text) => db.query(
    "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,$3,$4)", [userId, actorId, type, text]);

  // ---------------------------------------------------------------------------------------------
  // Dados de público (só para segmentação; nunca aparecem no perfil público)
  // ---------------------------------------------------------------------------------------------
  app.get("/api/provinces", (_req, res) => res.json({ provinces: ANGOLA_PROVINCES }));

  app.patch("/api/auth/me/audience", auth, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const province = body.province === undefined || body.province === "" || body.province === null ? null : String(body.province);
    if (province !== null && !ANGOLA_PROVINCES.includes(province)) return res.status(400).json({ error: "Província inválida." });
    const birth = parseBirthDate(body.birthDate === undefined ? null : body.birthDate);
    if (birth.error) return res.status(400).json({ error: birth.error });
    // A data de nascimento só se indica uma vez: decide o acesso aos grupos +18, por isso não se muda depois.
    const current = await pool.query("SELECT to_char(birth_date,'YYYY-MM-DD') AS birth_date FROM users WHERE id=$1", [req.user.id]);
    const savedBirth = current.rows[0]?.birth_date || null;
    if (savedBirth && birth.value && birth.value !== savedBirth) {
      return res.status(409).json({ error: "A data de nascimento já foi indicada e não pode ser alterada. Se está errada, contacta o suporte." });
    }
    const showToBrands = body.showProvinceToBrands === true;
    const result = await pool.query(
      `UPDATE users SET province=$2, birth_date=COALESCE(birth_date,$3), show_province_to_brands=$4 WHERE id=$1
       RETURNING province, to_char(birth_date,'YYYY-MM-DD') AS birth_date, show_province_to_brands`,
      [req.user.id, province, birth.value, showToBrands && province !== null]);
    if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    res.json(result.rows[0]);
  });

  app.get("/api/auth/me/audience", auth, async (req, res) => {
    const result = await pool.query("SELECT province, to_char(birth_date,'YYYY-MM-DD') AS birth_date, show_province_to_brands FROM users WHERE id=$1", [req.user.id]);
    res.json({ ...(result.rows[0] || {}), provinces: ANGOLA_PROVINCES });
  });

  // ---------------------------------------------------------------------------------------------
  // Estrelas Tchilar
  // ---------------------------------------------------------------------------------------------
  payments.register("stars", async (purchaseId, details) => {
    await transaction(async client => {
      const purchase = await client.query(
        "UPDATE star_purchases SET status='paid', paid_at=NOW(), stripe_payment_intent=$2 WHERE id=$1 AND status='pending' RETURNING user_id, stars",
        [purchaseId, details.paymentIntent || null]);
      if (!purchase.rowCount) return;
      await client.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,$2,'purchase')",
        [purchase.rows[0].user_id, purchase.rows[0].stars]);
    });
  });

  // Uma compra de verificação é da conta (page_id vazio) ou de uma página dessa conta: o selo fica em quem foi pago.
  payments.register("verification", async (purchaseId, details) => {
    await transaction(async client => {
      const purchase = await client.query(
        "UPDATE verification_purchases SET status='paid',paid_at=NOW(),stripe_payment_intent=$2 WHERE id=$1 AND status='pending' RETURNING user_id,page_id,tier",
        [purchaseId, details.paymentIntent || null]);
      if (!purchase.rowCount) return;
      const { user_id: userId, page_id: pageId, tier } = purchase.rows[0];
      const table = pageId ? "pages" : "users";
      const verified = await client.query(`
        UPDATE ${table} SET verification_tier=$2,
          verification_expires_at=GREATEST(COALESCE(verification_expires_at,NOW()),NOW()) + INTERVAL '1 month'
        WHERE id=$1 RETURNING verification_expires_at`,
      [pageId || userId, tier]);
      if (!verified.rowCount) throw new Error(pageId ? "A página da compra de verificação já não existe." : "A conta da compra de verificação já não existe.");
      await client.query("UPDATE verification_purchases SET expires_at=$2 WHERE id=$1",
        [purchaseId, verified.rows[0].verification_expires_at]);
    });
  });

  // Estado da verificação de uma conta ou de uma página: planos, selo ativo e seguidores.
  function verificationState(row) {
    const active = row.verification_tier && row.verification_expires_at > new Date()
      ? { tier: row.verification_tier, expires_at: row.verification_expires_at }
      : null;
    const plans = VERIFICATION_PLANS.map(plan => {
      const { minFollowers, ...details } = plan;
      return { ...details, minimum_followers: minFollowers, eligible: verificationEligibility(row.followers, plan.id) };
    });
    return {
      plans,
      active,
      followers: row.followers,
      minimum_followers: VERIFICATION_MIN_FOLLOWERS,
      eligible: plans.some(plan => plan.eligible),
      renewal: "manual"
    };
  }

  // Começa o pagamento de um plano. `subject` = a conta ou a página (email, nome, seguidores e selo atual).
  async function startVerificationCheckout(req, res, subject, { pageId = null, path }) {
    const plan = VERIFICATION_PLANS.find(item => item.id === req.body?.tier);
    if (!plan) return res.status(400).json({ error: "Plano de verificação inválido." });
    if (!verificationEligibility(subject.followers, plan.id)) {
      return res.status(403).json({ error: `O plano ${plan.name} exige pelo menos ${plan.minFollowers.toLocaleString("pt-PT")} seguidores para ativar ou renovar o selo.${pageId ? "" : " Amigos não contam."}` });
    }
    if (subject.verification_active && subject.verification_tier !== plan.id) {
      return res.status(409).json({ error: "Só podes mudar de plano quando a verificação atual terminar." });
    }
    const purchase = await pool.query(
      "INSERT INTO verification_purchases(user_id,page_id,tier,amount_kz) VALUES($1,$2,$3,$4) RETURNING id",
      [req.user.id, pageId, plan.id, plan.priceKz]);
    const purchaseId = purchase.rows[0].id;
    let result;
    try {
      result = await payments.start({
        purpose: "verification", refId: purchaseId, amountKz: plan.priceKz, userId: req.user.id,
        email: subject.email, method: req.body?.method, phone: req.body?.phone, promoCode: req.body?.promoCode,
        name: pageId ? `Selo verificado ${plan.name} da página ${subject.name} (1 mês)` : `Selo verificado ${plan.name} (1 mês)`,
        successPath: `${path}?pagamento=sucesso`,
        cancelPath: `${path}?pagamento=cancelado`
      });
    } catch (error) {
      await pool.query("UPDATE verification_purchases SET status='failed' WHERE id=$1 AND status='pending'", [purchaseId]);
      throw error;
    }
    if (result.error) {
      await pool.query("UPDATE verification_purchases SET status='failed' WHERE id=$1 AND status='pending'", [purchaseId]);
      return res.status(503).json({ error: result.error });
    }
    res.status(201).json(result);
  }

  app.get("/api/creator/verification", auth, async (req, res) => {
    const result = await pool.query(`
      SELECT u.verification_tier,u.verification_expires_at,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers
      FROM users u WHERE u.id=$1`, [req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    res.json(verificationState(result.rows[0]));
  });

  app.post("/api/creator/verification/checkout", auth, async (req, res) => {
    const user = await pool.query(`
      SELECT email,verification_tier,verification_expires_at > NOW() AS verification_active
        ,(SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers
      FROM users u WHERE id=$1`, [req.user.id]);
    if (!user.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    await startVerificationCheckout(req, res, user.rows[0], { path: "/creator/verificacao" });
  });

  // Verificação de páginas: só quem criou a página a pode comprar; contam os seguidores da página.
  const ownedPage = (pageId, userId) => pool.query(`
    SELECT p.name,p.verification_tier,p.verification_expires_at,
      COALESCE(p.verification_expires_at > NOW(),FALSE) AS verification_active,u.email,
      (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS followers
    FROM pages p JOIN users u ON u.id=p.owner_id
    WHERE p.id=$1 AND p.owner_id=$2 AND p.hidden_at IS NULL`, [pageId, userId]);

  app.get("/api/pages/:pageId/verification", auth, async (req, res) => {
    const pageId = parseId(req.params.pageId);
    if (!pageId) return res.status(400).json({ error: "Página inválida." });
    const page = await ownedPage(pageId, req.user.id);
    if (!page.rowCount) return res.status(404).json({ error: "Só quem criou a página pode tratar da verificação." });
    res.json({ ...verificationState(page.rows[0]), page: { id: pageId, name: page.rows[0].name } });
  });

  app.post("/api/pages/:pageId/verification/checkout", auth, async (req, res) => {
    const pageId = parseId(req.params.pageId);
    if (!pageId) return res.status(400).json({ error: "Página inválida." });
    const page = await ownedPage(pageId, req.user.id);
    if (!page.rowCount) return res.status(404).json({ error: "Só quem criou a página pode tratar da verificação." });
    await startVerificationCheckout(req, res, page.rows[0], { pageId, path: `/pages/${pageId}` });
  });

  app.get("/api/stars", auth, async (req, res) => {
    const [balance, history, received] = await Promise.all([
      pool.query(balanceSql, [req.user.id]),
      pool.query(`
        SELECT l.id,l.amount,l.kind,l.created_at,l.post_id,u.username,u.display_name
        FROM star_ledger l LEFT JOIN users u ON u.id=l.counterpart_id
        WHERE l.user_id=$1 ORDER BY l.created_at DESC, l.id DESC LIMIT 30`, [req.user.id]),
      pool.query("SELECT COALESCE(SUM(amount),0)::int AS stars FROM star_ledger WHERE user_id=$1 AND kind='gift_received'", [req.user.id])
    ]);
    res.json({
      balance: balance.rows[0].balance,
      price_kz: STAR_PRICE_KZ,
      gift_amounts: GIFT_AMOUNTS,
      packs: STAR_PACKS.map((pack, index) => ({ index, ...pack, price: packPrice(pack) })),
      history: history.rows,
      received: { stars: received.rows[0].stars, value_kz: starsValueKz(received.rows[0].stars) },
      payments: payments.mode
    });
  });

  app.post("/api/stars/purchase", auth, async (req, res) => {
    const pack = STAR_PACKS[Number(req.body?.pack)];
    if (!pack) return res.status(400).json({ error: "Pacote de estrelas inválido." });
    const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
    const purchase = await pool.query(
      "INSERT INTO star_purchases(user_id,stars,amount_kz) VALUES($1,$2,$3) RETURNING id",
      [req.user.id, pack.stars + pack.bonus, packPrice(pack)]);
    const id = purchase.rows[0].id;
    const result = await payments.start({
      purpose: "stars", refId: id, amountKz: packPrice(pack), userId: req.user.id, email: user.rows[0]?.email,
      method: req.body?.method, phone: req.body?.phone, promoCode: req.body?.promoCode,
      name: `${pack.stars}${pack.bonus ? ` + ${pack.bonus}` : ""} Estrelas Tchilar`,
      successPath: "/estrelas?pagamento=sucesso", cancelPath: "/estrelas?pagamento=cancelado",
      onSession: sessionId => pool.query("UPDATE star_purchases SET stripe_session_id=$2 WHERE id=$1", [id, sessionId])
    });
    if (result.error) return res.status(503).json({ error: result.error });
    res.status(201).json(result);
  });

  // Oferecer estrelas numa publicação: sai do saldo de quem oferece e entra no de quem publicou.
  app.post("/api/posts/:id/stars", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const amount = Number(req.body?.amount);
    if (!id || !GIFT_AMOUNTS.includes(amount)) return res.status(400).json({ error: "Quantidade de estrelas inválida." });
    const access = await canAccessPost(id, req.user.id);
    if (!access.exists) return res.status(404).json({ error: "Publicação não encontrada." });
    if (!access.allowed) return res.status(403).json({ error: "Não tens acesso a esta publicação." });
    const authorId = access.post.user_id;
    if (authorId === req.user.id) return res.status(400).json({ error: "Não podes oferecer estrelas a ti próprio." });
    const outcome = await transaction(async client => {
      // Bloqueio por pessoa: duas ofertas ao mesmo tempo não gastam o mesmo saldo duas vezes.
      await client.query("SELECT pg_advisory_xact_lock(42, $1)", [req.user.id]);
      const balance = (await client.query(balanceSql, [req.user.id])).rows[0].balance;
      if (balance < amount) return { error: "Não tens estrelas suficientes.", balance };
      await client.query(
        "INSERT INTO star_ledger(user_id,amount,kind,counterpart_id,post_id) VALUES($1,$2,'gift_sent',$3,$4),($3,$5,'gift_received',$1,$4)",
        [req.user.id, -amount, authorId, id, amount]);
      await notify(client, authorId, req.user.id, "stars", `Ofereceu-te ${amount} ${amount === 1 ? "estrela" : "estrelas"}.`);
      return { balance: balance - amount };
    });
    if (outcome.error) return res.status(402).json(outcome);
    const total = await pool.query("SELECT COALESCE(SUM(amount),0)::int AS stars FROM star_ledger WHERE post_id=$1 AND kind='gift_received'", [id]);
    res.json({ balance: outcome.balance, stars: total.rows[0].stars });
  });

  // Maiores apoiantes de um perfil (quem mais estrelas lhe ofereceu).
  app.get("/api/users/:username/supporters", optionalAuth, async (req, res) => {
    const result = await pool.query(`
      SELECT s.username,s.display_name,s.avatar_url,SUM(l.amount)::int AS stars
      FROM users u JOIN star_ledger l ON l.user_id=u.id AND l.kind='gift_received'
      JOIN users s ON s.id=l.counterpart_id
      WHERE u.username=$1 AND NOT ${blockedBetween("$2", "s.id")}
      GROUP BY s.id ORDER BY SUM(l.amount) DESC LIMIT 5`, [String(req.params.username).toLowerCase(), req.user?.id || 0]);
    res.json({ supporters: result.rows });
  });

  // ---------------------------------------------------------------------------------------------
  // Convites
  // ---------------------------------------------------------------------------------------------
  // Chamado depois de cada publicação: premeia quem convidou, uma única vez.
  async function rewardReferral(userId) {
    const result = await pool.query(`
      SELECT u.referred_by,u.email_verified,u.referral_rewarded_at,(SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id)::int AS posts
      FROM users u WHERE u.id=$1`, [userId]);
    const row = result.rows[0];
    if (!row?.referred_by || row.referral_rewarded_at) return false;
    if (!referralQualifies({ emailVerified: row.email_verified, posts: row.posts })) return false;
    return transaction(async client => {
      const marked = await client.query(
        "UPDATE users SET referral_rewarded_at=NOW() WHERE id=$1 AND referral_rewarded_at IS NULL RETURNING id", [userId]);
      if (!marked.rowCount) return false;
      await client.query("INSERT INTO star_ledger(user_id,amount,kind,counterpart_id) VALUES($1,$2,'referral_bonus',$3)",
        [row.referred_by, REFERRAL_BONUS_STARS, userId]);
      await notify(client, row.referred_by, userId, "referral", `Entrou no Tchilar com o teu convite. Ganhaste ${REFERRAL_BONUS_STARS} estrelas!`);
      return true;
    });
  }

  app.get("/api/referrals", auth, async (req, res) => {
    const [me, people] = await Promise.all([
      pool.query("SELECT username FROM users WHERE id=$1", [req.user.id]),
      pool.query(`
        SELECT username,display_name,avatar_url,created_at,referral_rewarded_at IS NOT NULL AS rewarded
        FROM users WHERE referred_by=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.id])
    ]);
    res.json({
      code: me.rows[0]?.username,
      bonus: REFERRAL_BONUS_STARS,
      invited: people.rows.length,
      rewarded: people.rows.filter(person => person.rewarded).length,
      people: people.rows
    });
  });

  // Ranking do mês (hora de Luanda): quem trouxe mais pessoas que já confirmaram o email e publicaram.
  // A província é privada: o ranking de uma província só mostra quem autorizou mostrar a província
  // (Definições → Público). A própria pessoa vê sempre a sua posição.
  app.get("/api/referrals/ranking", auth, async (req, res) => {
    const province = req.query.province ? String(req.query.province) : null;
    if (province && !ANGOLA_PROVINCES.includes(province)) return res.status(400).json({ error: "Província inválida." });
    const monthStart = "(date_trunc('month', NOW() AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda')";
    const ranked = `
      SELECT u.id,u.username,u.display_name,u.avatar_url,COUNT(*)::int AS invited,MIN(i.referral_rewarded_at) AS first_at,
        RANK() OVER (ORDER BY COUNT(*) DESC, MIN(i.referral_rewarded_at))::int AS position
      FROM users i JOIN users u ON u.id=i.referred_by
      WHERE i.referral_rewarded_at >= ${monthStart} AND u.suspended_at IS NULL
        AND ($1::text IS NULL OR (u.province=$1 AND (u.show_province_to_brands OR u.id=$2)))
      GROUP BY u.id`;
    const [top, me] = await Promise.all([
      pool.query(`SELECT * FROM (${ranked}) r ORDER BY position, first_at LIMIT 20`, [province, req.user.id]),
      pool.query(`SELECT position,invited FROM (${ranked}) r WHERE r.id=$2`, [province, req.user.id])
    ]);
    res.json({
      province,
      provinces: ANGOLA_PROVINCES,
      bonus: REFERRAL_BONUS_STARS,
      ranking: top.rows.map(({ id, first_at: _first, ...row }) => ({ ...row, is_me: id === req.user.id })),
      me: me.rows[0] || { position: null, invited: 0 }
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Marketplace de marcas
  // ---------------------------------------------------------------------------------------------
  app.get("/api/creators", optionalAuth, async (req, res) => {
    const province = typeof req.query.province === "string" && ANGOLA_PROVINCES.includes(req.query.province) ? req.query.province : null;
    const area = typeof req.query.area === "string" ? req.query.area.trim().slice(0, 60) : "";
    const minFollowers = [0, 1000, 10000, 100000].includes(Number(req.query.minFollowers)) ? Number(req.query.minFollowers) : 0;
    const result = await pool.query(`
      SELECT * FROM (
        SELECT u.id,u.username,u.display_name,u.avatar_url,u.bio,u.profession,
          -- A província é privada: só aparece (e só filtra) quando a pessoa autorizou.
          CASE WHEN u.show_province_to_brands THEN u.province END AS province,
          COALESCE(u.partner_since IS NOT NULL OR u.verification_expires_at > NOW(), FALSE) AS is_verified,
          CASE WHEN u.verification_expires_at > NOW() THEN u.verification_tier END AS verification_tier,
          (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id)::int AS posts
        FROM users u
        WHERE u.is_creator AND u.suspended_at IS NULL AND u.id <> $1 AND NOT ${blockedBetween("$1", "u.id")}
          AND ($2::text IS NULL OR (u.show_province_to_brands AND u.province=$2))
          AND ($3 = '' OR u.profession ILIKE '%' || $3 || '%' OR u.bio ILIKE '%' || $3 || '%')
      ) c WHERE c.followers >= $4
      ORDER BY CASE c.verification_tier WHEN 'benga' THEN 2 WHEN 'bolado' THEN 1 ELSE 0 END DESC,
        c.is_verified DESC, c.followers DESC LIMIT 60`, [req.user?.id || 0, province, area, minFollowers]);
    res.json({ creators: result.rows, provinces: ANGOLA_PROVINCES });
  });

  payments.register("campaign", async (campaignId, details) => {
    await transaction(async client => {
      const paid = await client.query(
        "UPDATE brand_campaigns SET status='paid', paid_at=NOW(), stripe_payment_intent=$2 WHERE id=$1 AND status='accepted' RETURNING creator_id, brand_id, title",
        [campaignId, details.paymentIntent || null]);
      if (paid.rowCount) {
        const row = paid.rows[0];
        await notify(client, row.creator_id, row.brand_id, "campaign", `Pagou a campanha «${row.title}». Podes começar.`);
      }
    });
  });

  const CAMPAIGN_FIELDS = `c.id,c.title,c.brief,c.budget::float AS budget,c.status,c.created_at,c.paid_at,c.completed_at,
    b.username AS brand_username,b.display_name AS brand_name,b.avatar_url AS brand_avatar,
    k.username AS creator_username,k.display_name AS creator_name,k.avatar_url AS creator_avatar`;

  app.post("/api/campaigns", auth, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const creatorId = parseId(body.creatorId);
    const title = cleanText(body.title);
    const brief = cleanText(body.brief);
    const budget = Number(body.budget);
    if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
    if (!title || title.length > 100) return res.status(400).json({ error: "O título deve ter entre 1 e 100 caracteres." });
    if (!brief || brief.length > 2000) return res.status(400).json({ error: "Descreve a campanha (até 2000 caracteres)." });
    if (!Number.isFinite(budget) || budget < MIN_CAMPAIGN_KZ || budget > MAX_CAMPAIGN_KZ) {
      return res.status(400).json({ error: `O orçamento deve estar entre ${MIN_CAMPAIGN_KZ.toLocaleString("pt-PT")} Kz e ${MAX_CAMPAIGN_KZ.toLocaleString("pt-PT")} Kz.` });
    }
    const creator = await pool.query(
      `SELECT id FROM users WHERE id=$1 AND is_creator AND suspended_at IS NULL AND NOT ${blockedBetween("$2", "id")}`, [creatorId, req.user.id]);
    if (!creator.rowCount) return res.status(404).json({ error: "Criador não encontrado." });
    const result = await pool.query(
      "INSERT INTO brand_campaigns(brand_id,creator_id,title,brief,budget) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [req.user.id, creatorId, title, brief, Math.round(budget * 100) / 100]);
    await notify(pool, creatorId, req.user.id, "campaign", `Enviou-te uma proposta de campanha: «${title}».`);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.get("/api/campaigns", auth, async (req, res) => {
    const query = side => pool.query(`
      SELECT ${CAMPAIGN_FIELDS} FROM brand_campaigns c
      JOIN users b ON b.id=c.brand_id JOIN users k ON k.id=c.creator_id
      WHERE c.${side}=$1 ORDER BY c.created_at DESC LIMIT 100`, [req.user.id]);
    const [received, sent] = await Promise.all([query("creator_id"), query("brand_id")]);
    const withSplit = rows => rows.map(row => ({ ...row, ...campaignSplit(row.budget) }));
    res.json({ received: withSplit(received.rows), sent: withSplit(sent.rows), payments: payments.mode });
  });

  // Transições permitidas: [quem pode fazer, estado atual, novo estado, notificação]
  const CAMPAIGN_ACTIONS = {
    accept: ["creator", "proposed", "accepted", "Aceitou a tua proposta. Já podes pagar a campanha."],
    decline: ["creator", "proposed", "declined", "Recusou a tua proposta de campanha."],
    cancel: ["brand", ["proposed", "accepted"], "cancelled", "Cancelou a proposta de campanha."],
    complete: ["brand", "paid", "completed", "Confirmou a entrega da campanha. Bom trabalho!"]
  };

  app.post("/api/campaigns/:id/:action", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const action = req.params.action;
    if (!id) return res.status(400).json({ error: "Campanha inválida." });
    const campaign = await pool.query("SELECT * FROM brand_campaigns WHERE id=$1 AND (brand_id=$2 OR creator_id=$2)", [id, req.user.id]);
    const row = campaign.rows[0];
    if (!row) return res.status(404).json({ error: "Campanha não encontrada." });
    const role = row.brand_id === req.user.id ? "brand" : "creator";

    if (action === "pay") {
      if (role !== "brand" || row.status !== "accepted") return res.status(409).json({ error: "Só podes pagar uma campanha aceite pelo criador." });
      const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
      const result = await payments.start({
        purpose: "campaign", refId: id, amountKz: row.budget, userId: req.user.id, email: user.rows[0]?.email,
        method: req.body?.method, phone: req.body?.phone, promoCode: req.body?.promoCode,
        name: `Campanha no Tchilar: ${row.title}`,
        successPath: "/creator/parcerias?pagamento=sucesso", cancelPath: "/creator/parcerias?pagamento=cancelado",
        onSession: sessionId => pool.query("UPDATE brand_campaigns SET stripe_session_id=$2 WHERE id=$1", [id, sessionId])
      });
      if (result.error) return res.status(503).json({ error: result.error });
      return res.json(result);
    }

    const rule = CAMPAIGN_ACTIONS[action];
    if (!rule) return res.status(404).json({ error: "Ação desconhecida." });
    const [who, from, to, message] = rule;
    const allowedFrom = Array.isArray(from) ? from : [from];
    if (role !== who || !allowedFrom.includes(row.status)) return res.status(409).json({ error: "Esta ação já não está disponível." });
    await pool.query(
      `UPDATE brand_campaigns SET status=$2${to === "completed" ? ", completed_at=NOW()" : ""} WHERE id=$1`, [id, to]);
    await notify(pool, role === "brand" ? row.creator_id : row.brand_id, req.user.id, "campaign", message);
    res.json({ status: to });
  });

  // ---------------------------------------------------------------------------------------------
  // Desafios mensais
  // ---------------------------------------------------------------------------------------------
  // Prémios: por lugar (1.º, 2.º, 3.º...), em estrelas e/ou Kz. Desafios antigos têm só prize_stars (1.º lugar).
  const CHALLENGE_PRIZES_SQL = "COALESCE(ch.prizes, jsonb_build_array(jsonb_build_object('place',1,'stars',ch.prize_stars,'cashKz',0)))";
  const CHALLENGE_FIELDS = `ch.id,ch.title,ch.description,ch.prize,ch.prize_stars,ch.sponsor,ch.starts_at,ch.ends_at,ch.closed_at,ch.winner_post_id,
    ch.level,ch.new_posts_only,ch.template_id,${CHALLENGE_PRIZES_SQL} AS prizes,
    (ch.ends_at > NOW() AND ch.closed_at IS NULL) AS is_open,
    (SELECT COUNT(*) FROM challenge_entries e WHERE e.challenge_id=ch.id)::int AS entries`;
  // Só quem trata do dinheiro (finanças ou super) pode criar, mudar, lançar ou encerrar prémios em Kz.
  const canGiveCash = req => ["super", "finance"].includes(req.user.adminRole);

  app.get("/api/challenges", optionalAuth, async (req, res) => {
    const result = await pool.query(`
      SELECT ${CHALLENGE_FIELDS},
        (SELECT e.post_id FROM challenge_entries e WHERE e.challenge_id=ch.id AND e.user_id=$1) AS my_post_id,
        wu.username AS winner_username, wu.display_name AS winner_name
      FROM challenges ch
      LEFT JOIN posts wp ON wp.id=ch.winner_post_id LEFT JOIN users wu ON wu.id=wp.user_id
      WHERE ch.ends_at > NOW() - INTERVAL '60 days'
      ORDER BY (ch.ends_at > NOW() AND ch.closed_at IS NULL) DESC, ch.level DESC NULLS LAST, ch.ends_at DESC LIMIT 60`, [req.user?.id || 0]);
    res.json({ challenges: result.rows });
  });

  // Classificação: por gostos (desempate pela participação mais antiga).
  const rankingSql = `
    SELECT e.post_id,e.user_id,e.created_at,u.username,u.display_name,u.avatar_url,LEFT(p.body,140) AS excerpt,p.media_url,p.media_type,
      p.like_count::int AS likes
    FROM challenge_entries e JOIN posts p ON p.id=e.post_id JOIN users u ON u.id=e.user_id
    WHERE e.challenge_id=$1 AND p.hidden_at IS NULL AND u.suspended_at IS NULL
    ORDER BY likes DESC, e.created_at ASC`;

  app.get("/api/challenges/:id", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Desafio inválido." });
    const [challenge, ranking, awards] = await Promise.all([
      pool.query(`SELECT ${CHALLENGE_FIELDS} FROM challenges ch WHERE ch.id=$1`, [id]),
      pool.query(`${rankingSql} LIMIT 20`, [id]),
      pool.query(`SELECT a.place,a.stars,a.cash_kz::float AS cash_kz,u.username,u.display_name,u.avatar_url
        FROM challenge_awards a JOIN users u ON u.id=a.user_id WHERE a.challenge_id=$1 ORDER BY a.place`, [id])
    ]);
    if (!challenge.rowCount) return res.status(404).json({ error: "Desafio não encontrado." });
    res.json({ challenge: challenge.rows[0], ranking: ranking.rows, awards: awards.rows });
  });

  // Desafio feito à mão (sem modelo). prizes: [{stars, cashKz}, ...] por lugar; prizeStars continua a valer (só 1.º lugar).
  app.post("/api/challenges", auth, requireAdmin, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const title = cleanText(body.title);
    const description = cleanText(body.description);
    const prize = cleanText(body.prize);
    const sponsor = cleanText(body.sponsor) || "Tchilar";
    const days = Number(body.days);
    const level = body.level === undefined || body.level === null ? null : Number(body.level);
    const prizeStars = Number(body.prizeStars || 0);
    if (!title || title.length > 100) return res.status(400).json({ error: "O título deve ter entre 1 e 100 caracteres." });
    if (description.length > 1000 || prize.length > 120 || sponsor.length > 80) return res.status(400).json({ error: "Um dos campos é demasiado longo." });
    if (body.prizes === undefined && (!Number.isInteger(prizeStars) || prizeStars < 0 || prizeStars > 1_000_000)) return res.status(400).json({ error: "Prémio em estrelas inválido." });
    const parsed = body.prizes !== undefined ? parsePrizes(body.prizes) : { prizes: [{ place: 1, stars: prizeStars, cashKz: 0 }] };
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (hasCash(parsed.prizes) && !canGiveCash(req)) return res.status(403).json({ error: "Só a equipa de finanças pode criar prémios em dinheiro." });
    if (level !== null && (!Number.isInteger(level) || level < 1 || level > 5)) return res.status(400).json({ error: "Nível inválido." });
    if (!Number.isInteger(days) || days < 1 || days > 62) return res.status(400).json({ error: "A duração deve ser entre 1 e 62 dias." });
    const result = await pool.query(`
      INSERT INTO challenges(title,description,prize,prize_stars,sponsor,ends_at,created_by,prizes,level,new_posts_only)
      VALUES($1,$2,$3,$4,$5,NOW() + ($6::int * INTERVAL '1 day'),$7,$8,$9,$10) RETURNING id`,
    [title, description, prize, parsed.prizes[0].stars, sponsor, days, req.user.id, JSON.stringify(parsed.prizes), level, body.newPostsOnly === true]);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.post("/api/challenges/:id/entries", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const postId = parseId(req.body?.postId);
    if (!id || !postId) return res.status(400).json({ error: "Pedido inválido." });
    const challenge = await pool.query("SELECT starts_at,new_posts_only FROM challenges WHERE id=$1 AND ends_at > NOW() AND closed_at IS NULL", [id]);
    if (!challenge.rowCount) return res.status(409).json({ error: "Este desafio já terminou." });
    const { starts_at: startsAt, new_posts_only: newOnly } = challenge.rows[0];
    const post = await pool.query(
      `SELECT 1 FROM posts WHERE id=$1 AND user_id=$2 AND NOT is_exclusive AND group_id IS NULL AND hidden_at IS NULL AND shared_post_id IS NULL
        AND ($3::boolean = FALSE OR created_at >= $4)`,
      [postId, req.user.id, newOnly, startsAt]);
    if (!post.rowCount) {
      return res.status(400).json({ error: newOnly ? "Escolhe uma publicação pública tua feita depois de o desafio começar." : "Escolhe uma publicação pública tua." });
    }
    const result = await pool.query(
      "INSERT INTO challenge_entries(challenge_id,post_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING post_id",
      [id, postId, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Já participas neste desafio com uma publicação." });
    res.status(201).json({ joined: true });
  });

  // Encerrar: os primeiros lugares (por gostos) recebem os prémios. Estrelas entram no saldo de estrelas;
  // o dinheiro entra no saldo de ganhos (levantamentos para o IBAN).
  app.post("/api/challenges/:id/close", auth, requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Desafio inválido." });
    const outcome = await transaction(async client => {
      const challenge = await client.query(`SELECT ch.title, ${CHALLENGE_PRIZES_SQL} AS prizes FROM challenges ch WHERE ch.id=$1 AND ch.closed_at IS NULL FOR UPDATE`, [id]);
      if (!challenge.rowCount) return { status: 409, error: "Este desafio já foi encerrado." };
      const row = challenge.rows[0];
      const prizes = row.prizes || [];
      if (hasCash(prizes) && !canGiveCash(req)) return { status: 403, error: "Este desafio tem prémios em dinheiro: só a equipa de finanças o encerra." };
      const ranking = (await client.query(`${rankingSql} LIMIT ${Math.max(1, prizes.length)}`, [id])).rows;
      await client.query("UPDATE challenges SET closed_at=NOW(), winner_post_id=$2 WHERE id=$1", [id, ranking[0]?.post_id || null]);
      const awards = [];
      for (const [index, entry] of ranking.entries()) {
        const prize = prizes[index];
        const stars = Number(prize?.stars) || 0;
        const cashKz = Number(prize?.cashKz) || 0;
        if (!stars && !cashKz) continue;
        await client.query("INSERT INTO challenge_awards(challenge_id,place,user_id,post_id,stars,cash_kz) VALUES($1,$2,$3,$4,$5,$6)",
          [id, index + 1, entry.user_id, entry.post_id, stars, cashKz]);
        if (stars > 0) {
          await client.query("INSERT INTO star_ledger(user_id,amount,kind,post_id) VALUES($1,$2,'challenge_prize',$3)", [entry.user_id, stars, entry.post_id]);
        }
        const what = [stars > 0 && `${stars} estrelas`, cashKz > 0 && `${cashKz.toLocaleString("pt-PT")} Kz no teu saldo`].filter(Boolean).join(" e ");
        await notify(client, entry.user_id, null, "challenge", `Ficaste em ${index + 1}.º lugar no desafio «${row.title}»! Prémio: ${what}.`);
        awards.push({ place: index + 1, username: entry.username, stars, cashKz });
      }
      return { winner: ranking[0] || null, awards };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.json(outcome);
  });

  // ----- Catálogo de modelos (Administração) -----
  app.get("/api/admin/challenge-templates", auth, requireAdmin, async (req, res) => {
    const result = await pool.query(`
      SELECT t.id,t.code,t.level,t.category,t.title,t.description,t.prizes,t.active,t.sort,t.updated_at,
        (SELECT MAX(c.starts_at) FROM challenges c WHERE c.template_id=t.id) AS last_launched_at,
        (SELECT COUNT(*) FROM challenges c WHERE c.template_id=t.id)::int AS times_launched
      FROM challenge_templates t ORDER BY t.level, t.sort, t.id`);
    res.json({ templates: result.rows, levels: LEVELS, canGiveCash: canGiveCash(req) });
  });

  const parseTemplate = (body, partial) => {
    const out = {};
    if (!partial || body.title !== undefined) {
      out.title = cleanText(body.title);
      if (!out.title || out.title.length > 100) return { error: "O título deve ter entre 1 e 100 caracteres." };
    }
    if (!partial || body.description !== undefined) {
      out.description = cleanText(body.description);
      if (out.description.length > 1000) return { error: "A descrição pode ter até 1000 caracteres." };
    }
    if (!partial || body.category !== undefined) {
      out.category = cleanText(body.category).toLowerCase() || "geral";
      if (out.category.length > 40) return { error: "Categoria demasiado longa." };
    }
    if (!partial || body.level !== undefined) {
      out.level = Number(body.level);
      if (!Number.isInteger(out.level) || out.level < 1 || out.level > 5) return { error: "Nível inválido (1 a 5)." };
    }
    if (!partial || body.prizes !== undefined) {
      const parsed = parsePrizes(body.prizes);
      if (parsed.error) return parsed;
      out.prizes = parsed.prizes;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") return { error: "Estado inválido." };
      out.active = body.active;
    }
    return { template: out };
  };

  app.post("/api/admin/challenge-templates", auth, requireAdmin, async (req, res) => {
    const parsed = parseTemplate(isRecord(req.body) ? req.body : {}, false);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const t = parsed.template;
    if (hasCash(t.prizes) && !canGiveCash(req)) return res.status(403).json({ error: "Só a equipa de finanças pode criar prémios em dinheiro." });
    const slug = t.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "desafio";
    const result = await pool.query(`
      INSERT INTO challenge_templates(code,level,category,title,description,prizes,sort,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(sort),0)+1 FROM challenge_templates),$7) RETURNING id`,
    [`${slug}-${Date.now().toString(36)}`, t.level, t.category, t.title, t.description, JSON.stringify(t.prizes), req.user.id]);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.patch("/api/admin/challenge-templates/:id", auth, requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Modelo inválido." });
    const parsed = parseTemplate(isRecord(req.body) ? req.body : {}, true);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const t = parsed.template;
    const current = await pool.query("SELECT prizes FROM challenge_templates WHERE id=$1", [id]);
    if (!current.rowCount) return res.status(404).json({ error: "Modelo não encontrado." });
    // Mexer em prémios com dinheiro (pôr, mudar ou tirar) é com as finanças.
    if (t.prizes && (hasCash(t.prizes) || hasCash(current.rows[0].prizes)) && !canGiveCash(req)) {
      return res.status(403).json({ error: "Só a equipa de finanças pode mudar prémios em dinheiro." });
    }
    const fields = Object.keys(t);
    if (!fields.length) return res.status(400).json({ error: "Nada para mudar." });
    const values = fields.map(key => key === "prizes" ? JSON.stringify(t[key]) : t[key]);
    await pool.query(`UPDATE challenge_templates SET ${fields.map((key, index) => `${key}=$${index + 2}`).join(",")}, updated_at=NOW(), updated_by=$${fields.length + 2} WHERE id=$1`,
      [id, ...values, req.user.id]);
    res.json({ updated: true });
  });

  // Lançar o mês: cria um desafio por modelo escolhido (até ao fim do mês, ou "days" dias) e avisa toda a gente.
  app.post("/api/admin/challenges/launch", auth, requireAdmin, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const ids = Array.isArray(body.templateIds) ? [...new Set(body.templateIds.map(Number))].filter(Number.isSafeInteger) : [];
    if (!ids.length || ids.length > 20) return res.status(400).json({ error: "Escolhe entre 1 e 20 desafios para lançar." });
    const days = body.days === undefined || body.days === null ? null : Number(body.days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 62)) return res.status(400).json({ error: "A duração deve ser entre 1 e 62 dias." });
    const templates = (await pool.query("SELECT * FROM challenge_templates WHERE id = ANY($1) AND active", [ids])).rows;
    if (templates.length !== ids.length) return res.status(400).json({ error: "Um dos desafios escolhidos não existe ou está desligado." });
    if (templates.some(t => hasCash(t.prizes)) && !canGiveCash(req)) return res.status(403).json({ error: "Há prémios em dinheiro: só a equipa de finanças lança estes desafios." });
    const launched = await transaction(async client => {
      const created = [];
      for (const t of templates) {
        // Sem "days": termina no último minuto do mês, hora de Luanda.
        const row = (await client.query(`
          INSERT INTO challenges(title,description,prize,prize_stars,sponsor,ends_at,created_by,template_id,level,prizes,new_posts_only)
          VALUES($1,$2,'',$3,'Tchilar',
            CASE WHEN $4::int IS NULL
              THEN (date_trunc('month', NOW() AT TIME ZONE 'Africa/Luanda') + INTERVAL '1 month' - INTERVAL '1 minute') AT TIME ZONE 'Africa/Luanda'
              ELSE NOW() + ($4::int * INTERVAL '1 day') END,
            $5,$6,$7,$8,TRUE) RETURNING id,title,ends_at`,
        [t.title, t.description, Number(t.prizes[0]?.stars) || 0, days, req.user.id, t.id, t.level, JSON.stringify(t.prizes)])).rows[0];
        created.push(row);
      }
      const cashTop = Math.max(0, ...templates.flatMap(t => t.prizes.map(prize => Number(prize.cashKz) || 0)));
      const text = `Novos desafios do mês: ${created.length} ${created.length === 1 ? "desafio" : "desafios"} com estrelas${cashTop ? ` e prémios até ${cashTop.toLocaleString("pt-PT")} Kz` : ""}. Participa!`;
      await client.query(`INSERT INTO notifications(user_id,actor_id,type,text)
        SELECT u.id,NULL,'challenge',$1 FROM users u WHERE u.suspended_at IS NULL`, [text]);
      return created;
    });
    res.status(201).json({ challenges: launched });
  });

  return { rewardReferral };
}

// Desafios do mês automáticos: no início de cada mês (hora de Luanda), se a equipa ainda não lançou
// desafios do catálogo nesse mês, lança um por nível (1 a 5), escolhendo em cada nível o que está há mais
// tempo sem sair (rotação). Só modelos ativos e sem prémios em dinheiro: esses precisam da equipa de finanças.
// Corre de hora a hora; o bloqueio na base de dados impede que duas cópias da API lancem em duplicado.
async function launchMonthlyChallenges({ pool, transaction }) {
  return transaction(async client => {
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(424242) AS ok");
    if (!lock.rows[0].ok) return [];
    const already = await client.query(`
      SELECT 1 FROM challenges WHERE template_id IS NOT NULL
        AND starts_at >= date_trunc('month', NOW() AT TIME ZONE 'Africa/Luanda') AT TIME ZONE 'Africa/Luanda' LIMIT 1`);
    if (already.rowCount) return [];
    const picks = (await client.query(`
      SELECT DISTINCT ON (t.level) t.*
      FROM challenge_templates t
      WHERE t.active AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.prizes) p WHERE COALESCE((p->>'cashKz')::numeric, 0) > 0)
      ORDER BY t.level, (SELECT MAX(c.starts_at) FROM challenges c WHERE c.template_id=t.id) ASC NULLS FIRST, t.sort, t.id`)).rows;
    if (!picks.length) return [];
    const created = [];
    for (const t of picks) {
      created.push((await client.query(`
        INSERT INTO challenges(title,description,prize,prize_stars,sponsor,ends_at,created_by,template_id,level,prizes,new_posts_only)
        VALUES($1,$2,'',$3,'Tchilar',
          (date_trunc('month', NOW() AT TIME ZONE 'Africa/Luanda') + INTERVAL '1 month' - INTERVAL '1 minute') AT TIME ZONE 'Africa/Luanda',
          NULL,$4,$5,$6,TRUE) RETURNING id,title,level,ends_at`,
      [t.title, t.description, Number(t.prizes[0]?.stars) || 0, t.id, t.level, JSON.stringify(t.prizes)])).rows[0]);
    }
    await client.query(`INSERT INTO notifications(user_id,actor_id,type,text)
      SELECT u.id,NULL,'challenge',$1 FROM users u WHERE u.suspended_at IS NULL`,
    [`Desafios do mês: ${created.length} novos desafios com estrelas. Participa!`]);
    // Os níveis com prémios em dinheiro ficam para a equipa de finanças lançar no painel.
    const missing = [1, 2, 3, 4, 5].filter(level => !created.some(item => item.level === level));
    if (missing.length) {
      await client.query(`INSERT INTO notifications(user_id,actor_id,type,text)
        SELECT u.id,NULL,'announcement',$1 FROM users u WHERE u.is_admin AND COALESCE(u.admin_role,'super') IN ('super','finance')`,
      [`Desafios do mês lançados (${created.length}). Os níveis ${missing.join(", ")} têm prémios em dinheiro: lança-os em Administração → Desafios.`]);
    }
    return created;
  });
}

module.exports = { launchMonthlyChallenges, registerGrowthRoutes };
