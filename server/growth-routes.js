// Rotas de crescimento e monetização: Estrelas Biva, convites, marketplace de marcas,
// desafios mensais e dados de público (província/idade). Registadas a partir de index.js.
const {
  ANGOLA_PROVINCES, GIFT_AMOUNTS, MAX_CAMPAIGN_KZ, MIN_CAMPAIGN_KZ, REFERRAL_BONUS_STARS, STAR_PACKS, STAR_PRICE_KZ,
  campaignSplit, packPrice, parseBirthDate, referralQualifies, starsValueKz
} = require("./growth");

// Saldo de estrelas para gastar: compras, prémios e bónus menos as ofertas feitas.
// As estrelas RECEBIDAS não entram aqui: valem dinheiro (70%) e vão para os ganhos (ver finance-routes.js).
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
    const showToBrands = body.showProvinceToBrands === true;
    const result = await pool.query(
      `UPDATE users SET province=$2, birth_date=$3, show_province_to_brands=$4 WHERE id=$1
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
  // Estrelas Biva
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
      name: `${pack.stars}${pack.bonus ? ` + ${pack.bonus}` : ""} Estrelas Biva`,
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
      await notify(client, row.referred_by, userId, "referral", `Entrou no Biva com o teu convite. Ganhaste ${REFERRAL_BONUS_STARS} estrelas!`);
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
          u.partner_since IS NOT NULL AS is_verified,
          (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id)::int AS posts
        FROM users u
        WHERE u.is_creator AND u.suspended_at IS NULL AND u.id <> $1 AND NOT ${blockedBetween("$1", "u.id")}
          AND ($2::text IS NULL OR (u.show_province_to_brands AND u.province=$2))
          AND ($3 = '' OR u.profession ILIKE '%' || $3 || '%' OR u.bio ILIKE '%' || $3 || '%')
      ) c WHERE c.followers >= $4
      ORDER BY c.is_verified DESC, c.followers DESC LIMIT 60`, [req.user?.id || 0, province, area, minFollowers]);
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
        name: `Campanha no Biva: ${row.title}`,
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
  const CHALLENGE_FIELDS = `ch.id,ch.title,ch.description,ch.prize,ch.prize_stars,ch.sponsor,ch.starts_at,ch.ends_at,ch.closed_at,ch.winner_post_id,
    (ch.ends_at > NOW() AND ch.closed_at IS NULL) AS is_open,
    (SELECT COUNT(*) FROM challenge_entries e WHERE e.challenge_id=ch.id)::int AS entries`;

  app.get("/api/challenges", optionalAuth, async (req, res) => {
    const result = await pool.query(`
      SELECT ${CHALLENGE_FIELDS},
        (SELECT e.post_id FROM challenge_entries e WHERE e.challenge_id=ch.id AND e.user_id=$1) AS my_post_id,
        wu.username AS winner_username, wu.display_name AS winner_name
      FROM challenges ch
      LEFT JOIN posts wp ON wp.id=ch.winner_post_id LEFT JOIN users wu ON wu.id=wp.user_id
      WHERE ch.ends_at > NOW() - INTERVAL '60 days'
      ORDER BY (ch.ends_at > NOW() AND ch.closed_at IS NULL) DESC, ch.ends_at DESC LIMIT 30`, [req.user?.id || 0]);
    res.json({ challenges: result.rows });
  });

  // Classificação: por gostos (desempate pela participação mais antiga).
  const rankingSql = `
    SELECT e.post_id,e.created_at,u.username,u.display_name,u.avatar_url,LEFT(p.body,140) AS excerpt,p.media_url,p.media_type,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id)::int AS likes
    FROM challenge_entries e JOIN posts p ON p.id=e.post_id JOIN users u ON u.id=e.user_id
    WHERE e.challenge_id=$1 AND p.hidden_at IS NULL AND u.suspended_at IS NULL
    ORDER BY likes DESC, e.created_at ASC`;

  app.get("/api/challenges/:id", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Desafio inválido." });
    const [challenge, ranking] = await Promise.all([
      pool.query(`SELECT ${CHALLENGE_FIELDS} FROM challenges ch WHERE ch.id=$1`, [id]),
      pool.query(`${rankingSql} LIMIT 20`, [id])
    ]);
    if (!challenge.rowCount) return res.status(404).json({ error: "Desafio não encontrado." });
    res.json({ challenge: challenge.rows[0], ranking: ranking.rows });
  });

  app.post("/api/challenges", auth, requireAdmin, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const title = cleanText(body.title);
    const description = cleanText(body.description);
    const prize = cleanText(body.prize);
    const sponsor = cleanText(body.sponsor) || "Biva";
    const prizeStars = Number(body.prizeStars || 0);
    const days = Number(body.days);
    if (!title || title.length > 100) return res.status(400).json({ error: "O título deve ter entre 1 e 100 caracteres." });
    if (description.length > 1000 || prize.length > 120 || sponsor.length > 80) return res.status(400).json({ error: "Um dos campos é demasiado longo." });
    if (!Number.isInteger(prizeStars) || prizeStars < 0 || prizeStars > 1_000_000) return res.status(400).json({ error: "Prémio em estrelas inválido." });
    if (!Number.isInteger(days) || days < 1 || days > 62) return res.status(400).json({ error: "A duração deve ser entre 1 e 62 dias." });
    const result = await pool.query(`
      INSERT INTO challenges(title,description,prize,prize_stars,sponsor,ends_at,created_by)
      VALUES($1,$2,$3,$4,$5,NOW() + ($6::int * INTERVAL '1 day'),$7) RETURNING id`,
    [title, description, prize, prizeStars, sponsor, days, req.user.id]);
    res.status(201).json({ id: result.rows[0].id });
  });

  app.post("/api/challenges/:id/entries", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const postId = parseId(req.body?.postId);
    if (!id || !postId) return res.status(400).json({ error: "Pedido inválido." });
    const challenge = await pool.query("SELECT 1 FROM challenges WHERE id=$1 AND ends_at > NOW() AND closed_at IS NULL", [id]);
    if (!challenge.rowCount) return res.status(409).json({ error: "Este desafio já terminou." });
    const post = await pool.query(
      "SELECT 1 FROM posts WHERE id=$1 AND user_id=$2 AND NOT is_exclusive AND group_id IS NULL AND hidden_at IS NULL AND shared_post_id IS NULL",
      [postId, req.user.id]);
    if (!post.rowCount) return res.status(400).json({ error: "Escolhe uma publicação pública tua." });
    const result = await pool.query(
      "INSERT INTO challenge_entries(challenge_id,post_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING post_id",
      [id, postId, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Já participas neste desafio com uma publicação." });
    res.status(201).json({ joined: true });
  });

  // Encerrar: a participação com mais gostos ganha; o prémio em estrelas é creditado automaticamente.
  app.post("/api/challenges/:id/close", auth, requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Desafio inválido." });
    const outcome = await transaction(async client => {
      const challenge = await client.query("SELECT * FROM challenges WHERE id=$1 AND closed_at IS NULL FOR UPDATE", [id]);
      if (!challenge.rowCount) return { error: "Este desafio já foi encerrado." };
      const [winner] = (await client.query(`${rankingSql} LIMIT 1`, [id])).rows;
      const winnerUser = winner ? (await client.query("SELECT user_id FROM posts WHERE id=$1", [winner.post_id])).rows[0]?.user_id : null;
      await client.query("UPDATE challenges SET closed_at=NOW(), winner_post_id=$2 WHERE id=$1", [id, winner?.post_id || null]);
      if (winnerUser) {
        const row = challenge.rows[0];
        if (row.prize_stars > 0) {
          await client.query("INSERT INTO star_ledger(user_id,amount,kind,post_id) VALUES($1,$2,'challenge_prize',$3)",
            [winnerUser, row.prize_stars, winner.post_id]);
        }
        await notify(client, winnerUser, null, "challenge", `Ganhaste o desafio «${row.title}»!${row.prize ? ` Prémio: ${row.prize}.` : ""}`);
      }
      return { winner: winner || null };
    });
    if (outcome.error) return res.status(409).json(outcome);
    res.json(outcome);
  });

  return { rewardReferral };
}

module.exports = { registerGrowthRoutes };
