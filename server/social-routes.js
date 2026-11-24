// Pesquisa, amigos, perfis, seguir, subscrições e bloqueios.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { ACTIVE_SUBSCRIPTION_SQL } = require("./subscriptions");
const { MIN_PRICE } = require("./subscriptions");
const { RENEWAL_WINDOW_DAYS } = require("./local-subscriptions");
const { blockedBetween } = require("./moderation");
const { canRenew } = require("./local-subscriptions");
const { makeRateLimit } = require("./rate-limit");
const { onlineSql } = require("./preferences");

function registerSocialRoutes(app, deps) {
  const {
    BLOCKED_ERROR, appUrl, applyStripeSubscription, auth, isBlocked, isRecord, likePattern, localSubscriptions,
    optionalAuth, parseHashtag, parseId, payments, pool, searchTerm, stripe, subscriptionCurrency, transaction
  } = deps;

  const searchRateLimit = makeRateLimit("search", {
    windowMs: 60 * 1000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Demasiadas pesquisas. Espera um minuto." }
  });

  // Pesquisa geral: pessoas, grupos, páginas e hashtags. As publicações vêm de GET /api/posts?q= (ou ?tag=),
  // que já aplica as regras de quem pode ver o quê. Grupos secretos nunca aparecem aqui.
  app.get("/api/search", auth, searchRateLimit, async (req, res) => {
    const term = searchTerm(req.query.q);
    if (!term) return res.json({ users: [], groups: [], pages: [], hashtags: [], events: [] });
    const tagPrefix = parseHashtag(term.replace(/^#/, "").split(" ")[0]);
    const like = likePattern(term.replace(/^#/, ""));
    const [users, groups, pages, hashtags, events] = await Promise.all([
      pool.query(`
        SELECT id,username,display_name,avatar_url,is_creator,
          COALESCE(partner_since IS NOT NULL OR verification_expires_at > NOW(), FALSE) AS is_verified,
          CASE WHEN verification_expires_at > NOW() THEN verification_tier END AS verification_tier
        FROM users
        WHERE id<>$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$1", "users.id")}
          AND (username ILIKE $2 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\')
        ORDER BY (lower(username)=lower($3)) DESC, display_name LIMIT 20`, [req.user.id, like, term.replace(/^@/, "")]),
      pool.query(`
        SELECT g.id,g.name,g.description,g.group_type,g.category,g.subcategory,g.requires_approval,g.invite_only,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
          EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS is_member
        FROM social_groups g
        WHERE g.hidden_at IS NULL AND NOT g.is_secret AND (g.name ILIKE $2 ESCAPE '\\' OR g.description ILIKE $2 ESCAPE '\\')
        ORDER BY member_count DESC, g.created_at DESC LIMIT 20`, [req.user.id, like]),
      pool.query(`
        SELECT p.id,p.name,p.page_type,p.category,p.subcategory,p.description,p.is_official,
          CASE WHEN p.verification_expires_at > NOW() THEN p.verification_tier END AS verification_tier,
          (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count
        FROM pages p
        WHERE p.hidden_at IS NULL AND (p.name ILIKE $1 ESCAPE '\\' OR p.description ILIKE $1 ESCAPE '\\' OR p.category ILIKE $1 ESCAPE '\\')
        ORDER BY follower_count DESC, p.created_at DESC LIMIT 20`, [like]),
      // Hashtags que começam pelo que foi escrito, nas publicações públicas dos últimos 6 meses.
      tagPrefix ? pool.query(`
        SELECT lower(m[1]) AS tag, COUNT(DISTINCT p.id)::int AS posts
        FROM posts p CROSS JOIN LATERAL regexp_matches(p.body, '#([[:alnum:]_]{1,50})', 'g') m
        WHERE p.hidden_at IS NULL AND p.group_id IS NULL AND NOT p.is_exclusive
          AND p.created_at > NOW() - INTERVAL '180 days' AND lower(m[1]) LIKE $1 ESCAPE '\\'
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`, [`${tagPrefix.toLowerCase().replace(/_/g, "\\_")}%`]) : { rows: [] },
      // Eventos ainda por acontecer (fora dos grupos), pelo nome, local ou descrição.
      pool.query(`
        SELECT e.id,e.name,e.location,e.starts_at,e.image_url,e.ticket_price_kz::float AS ticket_price_kz,
          (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count
        FROM events e
        WHERE e.group_id IS NULL AND e.starts_at > NOW() - INTERVAL '6 hours' AND NOT ${blockedBetween("$1", "e.creator_id")}
          AND (e.name ILIKE $2 ESCAPE '\\' OR e.location ILIKE $2 ESCAPE '\\' OR e.description ILIKE $2 ESCAPE '\\')
        ORDER BY e.starts_at LIMIT 10`, [req.user.id, like])
    ]);
    res.json({ users: users.rows, groups: groups.rows, pages: pages.rows, hashtags: hashtags.rows, events: events.rows });
  });

  app.get("/api/users/search", auth, async (req, res) => {
    const search = String(req.query.q || "").trim();
    if (search.length < 1) return res.json({ users: [] });
    const r = await pool.query(`
      SELECT id,username,display_name,avatar_url
      FROM users
      WHERE id<>$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$1", "users.id")}
        AND (username ILIKE $2 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\')
      ORDER BY display_name LIMIT 20`, [req.user.id, `%${search.slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`]);
    res.json({ users: r.rows });
  });

  app.get("/api/friends", auth, async (req, res) => {
    const [friends, requests, suggestions] = await Promise.all([
      pool.query(`
        SELECT u.id,u.username,u.display_name,u.avatar_url,${onlineSql("u")} AS online
        FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END
        WHERE f.user_a_id=$1 OR f.user_b_id=$1
        ORDER BY online DESC, u.display_name`, [req.user.id]),
      pool.query(`
        SELECT r.id,r.created_at,u.id AS user_id,u.username,u.display_name,u.avatar_url
        FROM friend_requests r JOIN users u ON u.id=r.requester_id
        WHERE r.addressee_id=$1 AND r.status='pending'
        ORDER BY r.created_at DESC`, [req.user.id]),
      pool.query(`
        SELECT u.id,u.username,u.display_name,u.avatar_url
        FROM users u
        WHERE u.id<>$1 AND u.suspended_at IS NULL AND u.email_verified
          AND NOT ${blockedBetween("$1", "u.id")}
          AND NOT EXISTS (
            SELECT 1 FROM friendships f
            WHERE (f.user_a_id=$1 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM friend_requests r
            WHERE r.status='pending'
              AND ((r.requester_id=$1 AND r.addressee_id=u.id) OR (r.requester_id=u.id AND r.addressee_id=$1))
          )
        ORDER BY u.created_at DESC LIMIT 12`, [req.user.id])
    ]);
    res.json({ friends: friends.rows, requests: requests.rows, suggestions: suggestions.rows });
  });

  app.post("/api/friends/:userId/request", auth, async (req, res) => {
    const other = parseId(req.params.userId);
    if (!other || other === req.user.id) {
      return res.status(400).json({ error: "Pedido de amizade inválido." });
    }
    if (await isBlocked(req.user.id, other)) return res.status(403).json({ error: BLOCKED_ERROR });
    const friendship = await pool.query(`
      SELECT 1 FROM friendships
      WHERE (user_a_id=$1 AND user_b_id=$2) OR (user_a_id=$2 AND user_b_id=$1)`,
    [req.user.id, other]);
    if (friendship.rowCount) return res.status(409).json({ error: "Já são amigos." });
    const reverseRequest = await pool.query(`
      SELECT id FROM friend_requests
      WHERE requester_id=$1 AND addressee_id=$2 AND status='pending'`,
    [other, req.user.id]);
    if (reverseRequest.rowCount) return res.status(409).json({ error: "Este utilizador já te enviou um pedido." });
    try {
      const requestId = await transaction(async client => {
        const result = await client.query(`
          INSERT INTO friend_requests(requester_id,addressee_id) VALUES($1,$2)
          RETURNING id`, [req.user.id, other]);
        await client.query(
          "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'friend_request','Recebeste um pedido de amizade.')",
          [other, req.user.id]);
        return result.rows[0].id;
      });
      res.status(201).json({ requestId });
    } catch (error) {
      if (error.code === "23503") return res.status(404).json({ error: "Utilizador não encontrado." });
      if (error.code === "23505") return res.status(409).json({ error: "Já existe um pedido de amizade pendente." });
      throw error;
    }
  });

  app.post("/api/friends/requests/:requestId/accept", auth, async (req, res) => {
    const id = parseId(req.params.requestId);
    if (!id) return res.status(400).json({ error: "Pedido inválido." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query(`
        SELECT id,requester_id FROM friend_requests
        WHERE id=$1 AND addressee_id=$2 AND status='pending' FOR UPDATE`,
      [id, req.user.id]);
      if (!request.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Pedido não encontrado." });
      }
      const requesterId = request.rows[0].requester_id;
      await client.query(
        "INSERT INTO friendships(user_a_id,user_b_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [Math.min(req.user.id, requesterId), Math.max(req.user.id, requesterId)]);
      await client.query("UPDATE friend_requests SET status='accepted' WHERE id=$1", [id]);
      await client.query(
        "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'friend_accepted','O teu pedido de amizade foi aceite.')",
        [requesterId, req.user.id]);
      await client.query("COMMIT");
      res.json({ accepted: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/friends/requests/:requestId/reject", auth, async (req, res) => {
    const id = parseId(req.params.requestId);
    if (!id) return res.status(400).json({ error: "Pedido inválido." });
    const result = await pool.query(`
      UPDATE friend_requests SET status='rejected'
      WHERE id=$1 AND addressee_id=$2 AND status='pending'
      RETURNING id`, [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Pedido não encontrado." });
    res.json({ rejected: true });
  });

  app.get("/api/users/:username", optionalAuth, async (req, res) => {
    const r = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.cover_url,u.cover_position,u.location,u.website,u.profession,
        u.is_creator,u.subscription_price,u.created_at,
        COALESCE(u.partner_since IS NOT NULL OR u.verification_expires_at > NOW(), FALSE) AS is_verified,
        CASE WHEN u.verification_expires_at > NOW() THEN u.verification_tier END AS verification_tier,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
        (SELECT COUNT(*) FROM follows f WHERE f.follower_id=u.id)::int AS following,
        (SELECT COUNT(*) FROM friendships f WHERE f.user_a_id=u.id OR f.user_b_id=u.id)::int AS friends,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.group_id IS NULL)::int AS posts,
        (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=u.id)::int AS likes_received,
        (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=u.id AND c.user_id<>u.id)::int AS comments_received,
        CASE WHEN u.is_creator THEN (
          SELECT COUNT(*) FROM subscriptions s WHERE s.creator_id=u.id AND ${ACTIVE_SUBSCRIPTION_SQL}
        )::int END AS subscribers,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2 AND f.following_id=u.id) AS is_following,
        EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=$2 AND b.blocked_id=u.id) AS is_blocked,
        EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$2) AS blocked_me,
        u.suspended_at IS NOT NULL AS suspended,
        EXISTS(
          SELECT 1 FROM friendships f
          WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$2)
        ) AS is_friend,
        EXISTS(SELECT 1 FROM friend_requests r WHERE r.status='pending' AND r.requester_id=$2 AND r.addressee_id=u.id) AS friend_request_sent,
        -- "Online" só para amigos (e só se a pessoa não escondeu a atividade).
        (${onlineSql("u")} AND EXISTS(
          SELECT 1 FROM friendships f
          WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_a_id=u.id AND f.user_b_id=$2))) AS online,
        s.current_period_end AS subscription_period_end,
        s.cancel_at_period_end AS subscription_canceling,
        s.provider AS subscription_provider,
        (s.subscriber_id IS NOT NULL AND ${ACTIVE_SUBSCRIPTION_SQL}) AS is_subscribed
      FROM users u
      LEFT JOIN subscriptions s ON s.creator_id=u.id AND s.subscriber_id=$2
      WHERE u.username=$1`, [req.params.username, req.user?.id || 0]);
    // Quem me bloqueou ou está suspenso aparece como inexistente.
    if (!r.rows[0] || r.rows[0].blocked_me || r.rows[0].suspended) return res.status(404).json({ error: "Utilizador não encontrado." });
    const { blocked_me: _blockedMe, suspended: _suspended, ...user } = r.rows[0];
    // Paga mês a mês (sem Stripe): não renova sozinha; can_renew diz se já pode pagar o mês seguinte.
    user.subscription_manual = user.is_subscribed && user.subscription_provider !== "stripe";
    user.subscription_can_renew = user.is_subscribed && canRenew({ provider: user.subscription_provider, current_period_end: user.subscription_period_end, cancel_at_period_end: user.subscription_canceling });
    delete user.subscription_provider;
    if (!user.is_subscribed) {
      user.subscription_period_end = null;
      user.subscription_canceling = false;
    }
    if (req.user && req.user.id !== user.id) {
      // Conta no máximo uma visita por pessoa e por dia; uma falha aqui não impede ver o perfil.
      pool.query(
        "INSERT INTO profile_views(profile_id,viewer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [user.id, req.user.id]).catch(error => console.error("Profile view not recorded:", error.code || error.name));
    }
    res.json({ user });
  });

  // Amigos de um perfil (até 9 para o cartão "Amigos"): primeiro os que também são amigos de quem vê.
  // Quem bloqueou ou foi bloqueado por quem vê não aparece; o perfil bloqueado/suspenso dá 404 como acima.
  app.get("/api/users/:username/friends", optionalAuth, async (req, res) => {
    const viewerId = req.user?.id || 0;
    const owner = await pool.query(
      `SELECT u.id FROM users u WHERE u.username=$1 AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}`,
      [req.params.username, viewerId]);
    if (!owner.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
    const ownerId = owner.rows[0].id;
    const friendsOf = param => `SELECT CASE WHEN f.user_a_id=${param} THEN f.user_b_id ELSE f.user_a_id END
      FROM friendships f WHERE f.user_a_id=${param} OR f.user_b_id=${param}`;
    const result = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,
        (u.id IN (${friendsOf("$2")})) AS mutual,
        COUNT(*) OVER()::int AS total,
        COUNT(*) FILTER (WHERE u.id IN (${friendsOf("$2")})) OVER()::int AS mutual_total
      FROM users u
      WHERE u.id IN (${friendsOf("$1")}) AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}
      ORDER BY mutual DESC, u.display_name
      LIMIT 9`, [ownerId, viewerId]);
    const rows = result.rows;
    res.json({
      friends: rows.map(({ total: _total, mutual_total: _mutualTotal, ...friend }) => friend),
      total: rows[0]?.total || 0,
      mutual: viewerId && viewerId !== ownerId ? rows[0]?.mutual_total || 0 : 0
    });
  });

  app.post("/api/users/:id/follow", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Utilizador inválido." });
    if (id === req.user.id) return res.status(400).json({ error: "Não podes seguir a própria conta." });
    if (await isBlocked(req.user.id, id)) return res.status(403).json({ error: BLOCKED_ERROR });
    const target = await pool.query("SELECT 1 FROM users WHERE id=$1", [id]);
    if (!target.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
    const following = await transaction(async client => {
      const removed = await client.query(
        "DELETE FROM follows WHERE follower_id=$1 AND following_id=$2 RETURNING following_id",
        [req.user.id, id]);
      if (removed.rowCount) return false;
      const inserted = await client.query(
        "INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING following_id",
        [req.user.id, id]);
      if (inserted.rowCount) {
        await client.query(`
          INSERT INTO notifications(user_id,actor_id,type,text)
          VALUES($1,$2,'follow','Começou a seguir-te.')`, [id, req.user.id]);
      }
      return true;
    });
    res.json({ following });
  });

  // Subscrever (ou renovar) um criador. Cartão com a Stripe = subscrição que se cobra sozinha todos os meses.
  // Express, Referência, PayPal e RedotPay = paga-se um mês de cada vez (ver local-subscriptions.js).
  app.post("/api/subscriptions/:creatorId", auth, async (req, res) => {
    const creatorId = parseId(req.params.creatorId);
    if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
    if (await isBlocked(req.user.id, creatorId)) return res.status(403).json({ error: BLOCKED_ERROR });
    if (payments.mode === "off") {
      return res.status(503).json({ error: "Os pagamentos ainda não estão disponíveis." });
    }
    const body = isRecord(req.body) ? req.body : {};
    const method = typeof body.method === "string" ? body.method : "";
    const [creatorResult, subscriberResult, existingResult] = await Promise.all([
      pool.query("SELECT id,username,display_name,is_creator,subscription_price FROM users WHERE id=$1", [creatorId]),
      pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]),
      pool.query(`
        SELECT s.provider,s.provider_subscription_id,s.cancel_at_period_end,s.current_period_end,(${ACTIVE_SUBSCRIPTION_SQL}) AS active
        FROM subscriptions s WHERE s.subscriber_id=$1 AND s.creator_id=$2`, [req.user.id, creatorId])
    ]);
    const creator = creatorResult.rows[0];
    if (!creator || !creator.is_creator) return res.status(404).json({ error: "Criador não encontrado." });
    const price = Number(creator.subscription_price);
    if (!(price >= MIN_PRICE)) return res.status(409).json({ error: "Este criador ainda não definiu um preço de subscrição." });
    const email = subscriberResult.rows[0]?.email;
    const payMonth = async () => {
      const result = await localSubscriptions.startPayment({ subscriberId: req.user.id, email, creator, method: method || undefined, phone: body.phone, promoCode: body.promoCode });
      if (result.error) return res.status(result.methods ? 400 : 503).json(result);
      return res.status(201).json(result);
    };

    const existing = existingResult.rows[0];
    if (existing?.active) {
      // Paga mês a mês: com um método escolhido, paga o mês seguinte (nos últimos 7 dias, ou depois de cancelar).
      if (existing.provider !== "stripe" && method) {
        if (!canRenew(existing)) return res.status(409).json({ error: `Já tens este mês pago. Podes renovar nos últimos ${RENEWAL_WINDOW_DAYS} dias.` });
        return payMonth();
      }
      if (!existing.cancel_at_period_end) return res.status(409).json({ error: "Já tens uma subscrição ativa." });
      // Retomar uma subscrição que ia terminar no fim do período.
      if (existing.provider === "stripe") {
        await applyStripeSubscription(await stripe.subscriptions.update(existing.provider_subscription_id, { cancel_at_period_end: false }));
        return res.json({ subscribed: true, message: "A tua subscrição vai continuar a renovar." });
      }
      await pool.query(
        "UPDATE subscriptions SET cancel_at_period_end=FALSE,updated_at=NOW() WHERE subscriber_id=$1 AND creator_id=$2",
        [req.user.id, creatorId]);
      return res.json({ subscribed: true, message: "Vamos avisar-te antes do fim do mês para renovares." });
    }

    // Sem método escolhido (app antiga): cartão se houver Stripe; senão, o único método que existir.
    const useStripe = stripe && (method === "card" || (!method && !payments.methods.some(id => id !== "card")));
    if (!useStripe) return payMonth();

    const metadata = { subscriber_id: String(req.user.id), creator_id: String(creatorId) };
    const profileUrl = new URL(`/u/${encodeURIComponent(creator.username)}`, appUrl);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      client_reference_id: String(req.user.id),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: subscriptionCurrency,
          unit_amount: Math.round(price * 100),
          recurring: { interval: "month" },
          product_data: { name: `Subscrição de ${creator.display_name} no Tchilar` }
        }
      }],
      metadata,
      subscription_data: { metadata },
      success_url: `${profileUrl}?subscription=success`,
      cancel_url: `${profileUrl}?subscription=cancelled`
    });
    res.json({ checkoutUrl: session.url });
  });

  app.delete("/api/subscriptions/:creatorId", auth, async (req, res) => {
    const creatorId = parseId(req.params.creatorId);
    if (!creatorId || creatorId === req.user.id) return res.status(400).json({ error: "Criador inválido." });
    const result = await pool.query(`
      SELECT s.provider,s.provider_subscription_id,s.cancel_at_period_end,s.current_period_end
      FROM subscriptions s
      WHERE s.subscriber_id=$1 AND s.creator_id=$2 AND ${ACTIVE_SUBSCRIPTION_SQL}`, [req.user.id, creatorId]);
    const subscription = result.rows[0];
    if (!subscription) return res.status(404).json({ error: "Não tens uma subscrição ativa deste criador." });
    // O acesso mantém-se até ao fim do período já pago; apenas deixa de renovar.
    if (!subscription.cancel_at_period_end) {
      if (subscription.provider === "stripe") {
        if (!stripe) return res.status(503).json({ error: "Os pagamentos não estão configurados." });
        await applyStripeSubscription(await stripe.subscriptions.update(subscription.provider_subscription_id, { cancel_at_period_end: true }));
      } else {
        await pool.query(
          "UPDATE subscriptions SET cancel_at_period_end=TRUE,updated_at=NOW() WHERE subscriber_id=$1 AND creator_id=$2",
          [req.user.id, creatorId]);
      }
    }
    res.json({ canceled: true, accessUntil: subscription.current_period_end });
  });

  // ---------------------------------------------------------------------------------------------
  // Bloquear, denunciar e moderar
  // ---------------------------------------------------------------------------------------------

  app.get("/api/blocks", auth, async (req, res) => {
    const result = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,b.created_at
      FROM blocks b JOIN users u ON u.id=b.blocked_id
      WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`, [req.user.id]);
    res.json({ blocked: result.rows });
  });

  app.post("/api/users/:id/block", auth, async (req, res) => {
    const other = parseId(req.params.id);
    if (!other || other === req.user.id) return res.status(400).json({ error: "Utilizador inválido." });
    const target = await pool.query("SELECT 1 FROM users WHERE id=$1", [other]);
    if (!target.rowCount) return res.status(404).json({ error: "Utilizador não encontrado." });
    // Bloquear corta todas as ligações entre as duas contas.
    await transaction(async client => {
      await client.query("INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, other]);
      await client.query(
        "DELETE FROM friendships WHERE user_a_id=LEAST($1::int,$2::int) AND user_b_id=GREATEST($1::int,$2::int)", [req.user.id, other]);
      await client.query(
        "DELETE FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)", [req.user.id, other]);
      await client.query(`
        UPDATE friend_requests SET status='rejected'
        WHERE status='pending' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
      [req.user.id, other]);
    });
    res.json({ blocked: true });
  });

  app.delete("/api/users/:id/block", auth, async (req, res) => {
    const other = parseId(req.params.id);
    if (!other) return res.status(400).json({ error: "Utilizador inválido." });
    await pool.query("DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2", [req.user.id, other]);
    res.json({ blocked: false });
  });
}

module.exports = { registerSocialRoutes };
