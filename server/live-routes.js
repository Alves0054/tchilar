// Diretos (lives). O vídeo vai diretamente de quem emite para cada espectador (WebRTC); o servidor
// só faz a "sinalização" (troca de ofertas/respostas) e guarda chat, espectadores e estrelas.
// Para muitos espectadores ao mesmo tempo é preciso um servidor de média (LiveKit, Mux...).
const { GIFT_AMOUNTS } = require("./growth");

const HOST_TIMEOUT_SECONDS = 120;   // sem sinal de quem emite há 2 min → o direto termina
const VIEWER_WINDOW_SECONDS = 30;   // conta como a ver quem deu sinal nos últimos 30 s
const MAX_VIDEO_VIEWERS = 8;        // ligações de vídeo diretas por emissão (o chat não tem limite)
const STUN = { urls: "stun:stun.cloudflare.com:3478" };
const TURN_TTL_SECONDS = 12 * 60 * 60;

// Servidor TURN (retransmissão). Com LIVE_TURN_SECRET (coturn "use-auth-secret"), cada pessoa recebe
// credenciais temporárias que expiram em 12 h — nunca a palavra-passe fixa do servidor.
// Com TURN configurado, o vídeo passa SEMPRE pela retransmissão ("relay"): quem emite e quem vê só
// veem o IP do servidor TURN, nunca o IP de casa ou do telemóvel um do outro.
// LIVE_TURN_RELAY_ONLY=false volta a permitir ligações diretas (mais rápidas, mas expõem o IP).
function turnServer(userId, env, now = Date.now()) {
  const urls = String(env.LIVE_TURN_URL || "").split(",").map(url => url.trim()).filter(Boolean);
  if (!urls.length) return { iceServers: [STUN], iceTransportPolicy: "all" };
  let username = env.LIVE_TURN_USERNAME || "";
  let credential = env.LIVE_TURN_CREDENTIAL || "";
  if (env.LIVE_TURN_SECRET) {
    username = `${Math.floor(now / 1000) + TURN_TTL_SECONDS}:${userId}`;
    credential = require("crypto").createHmac("sha1", env.LIVE_TURN_SECRET).update(username).digest("base64");
  }
  const relayOnly = env.LIVE_TURN_RELAY_ONLY !== "false";
  return {
    iceServers: relayOnly ? [{ urls, username, credential }] : [STUN, { urls, username, credential }],
    iceTransportPolicy: relayOnly ? "relay" : "all"
  };
}

const balanceSql ="SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS balance FROM star_ledger WHERE user_id=$1";

function registerLiveRoutes(app, deps) {
  const { pool, auth, optionalAuth, parseId, isRecord, cleanText, transaction, blockedBetween } = deps;

  const turnConfig = userId => turnServer(userId, process.env);

  const endStaleLives = () => pool.query(`
    UPDATE lives SET status='ended', ended_at=NOW()
    WHERE status='live' AND host_seen_at < NOW() - make_interval(secs => $1)`, [HOST_TIMEOUT_SECONDS]);

  const LIVE_FIELDS = `l.id,l.title,l.status,l.started_at,l.ended_at,l.peak_viewers,
    u.id AS host_id,u.username,u.display_name,u.avatar_url,u.partner_since IS NOT NULL AS is_verified,
    (SELECT COUNT(*) FROM live_viewers v WHERE v.live_id=l.id AND v.last_seen > NOW() - make_interval(secs => ${VIEWER_WINDOW_SECONDS}))::int AS viewers,
    (SELECT COALESCE(SUM(s.amount),0) FROM star_ledger s WHERE s.live_id=l.id AND s.kind='gift_received')::int AS stars`;

  // Quem pode ver: o direto existe e não há bloqueio entre as duas pessoas.
  async function loadLive(id, viewerId) {
    const result = await pool.query(
      `SELECT ${LIVE_FIELDS} FROM lives l JOIN users u ON u.id=l.host_id
       WHERE l.id=$1 AND NOT ${blockedBetween("$2", "l.host_id")}`, [id, viewerId || 0]);
    return result.rows[0] || null;
  }

  // As credenciais TURN só vão para quem tem sessão iniciada (só essas pessoas recebem vídeo).
  app.get("/api/lives/config", optionalAuth, (req, res) => {
    const { iceServers, iceTransportPolicy } = req.user ? turnConfig(req.user.id) : { iceServers: [STUN], iceTransportPolicy: "all" };
    res.json({ iceServers, iceTransportPolicy, maxVideoViewers: MAX_VIDEO_VIEWERS, giftAmounts: GIFT_AMOUNTS });
  });

  app.get("/api/lives", optionalAuth, async (req, res) => {
    await endStaleLives();
    const result = await pool.query(`
      SELECT ${LIVE_FIELDS} FROM lives l JOIN users u ON u.id=l.host_id
      WHERE l.status='live' AND NOT ${blockedBetween("$1", "l.host_id")}
      ORDER BY (l.host_id=$1) DESC, l.started_at DESC LIMIT 50`, [req.user?.id || 0]);
    res.json({ lives: result.rows });
  });

  app.post("/api/lives", auth, async (req, res) => {
    const title = cleanText(isRecord(req.body) ? req.body.title : "");
    if (!title || title.length > 120) return res.status(400).json({ error: "Dá um título ao direto (até 120 caracteres)." });
    await endStaleLives();
    let live;
    try {
      live = (await pool.query("INSERT INTO lives(host_id,title) VALUES($1,$2) RETURNING id", [req.user.id, title])).rows[0];
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Já tens um direto a decorrer." });
      throw error;
    }
    // Avisa quem segue (até 1000 pessoas).
    await pool.query(`
      INSERT INTO notifications(user_id,actor_id,type,text)
      SELECT f.follower_id,$1,'live',$2 FROM follows f WHERE f.following_id=$1 LIMIT 1000`,
    [req.user.id, `Está em direto: ${title}`]);
    res.status(201).json({ id: live.id });
  });

  app.get("/api/lives/:id", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    await endStaleLives();
    const live = await loadLive(id, req.user?.id);
    if (!live) return res.status(404).json({ error: "Direto não encontrado." });
    const supporters = await pool.query(`
      SELECT u.username,u.display_name,u.avatar_url,SUM(s.amount)::int AS stars
      FROM star_ledger s JOIN users u ON u.id=s.counterpart_id
      WHERE s.live_id=$1 AND s.kind='gift_received' GROUP BY u.id ORDER BY SUM(s.amount) DESC LIMIT 5`, [id]);
    res.json({ live: { ...live, is_host: Boolean(req.user && req.user.id === live.host_id) }, supporters: supporters.rows });
  });

  // Sinal de vida: quem emite mantém o direto ativo; espectadores contam como "a ver".
  app.post("/api/lives/:id/heartbeat", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    const live = await loadLive(id, req.user.id);
    if (!live) return res.status(404).json({ error: "Direto não encontrado." });
    if (live.status !== "live") return res.json({ status: live.status, viewers: 0 });
    if (live.host_id === req.user.id) {
      await pool.query("UPDATE lives SET host_seen_at=NOW() WHERE id=$1", [id]);
    } else {
      await pool.query(`
        INSERT INTO live_viewers(live_id,user_id) VALUES($1,$2)
        ON CONFLICT(live_id,user_id) DO UPDATE SET last_seen=NOW()`, [id, req.user.id]);
    }
    const fresh = await loadLive(id, req.user.id);
    await pool.query("UPDATE lives SET peak_viewers=GREATEST(peak_viewers,$2) WHERE id=$1", [id, fresh.viewers]);
    res.json({ status: fresh.status, viewers: fresh.viewers, stars: fresh.stars });
  });

  app.post("/api/lives/:id/end", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const result = await pool.query(
      "UPDATE lives SET status='ended', ended_at=NOW() WHERE id=$1 AND host_id=$2 AND status='live' RETURNING peak_viewers", [id, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Este direto já terminou." });
    res.json({ status: "ended", peak_viewers: result.rows[0].peak_viewers });
  });

  // Chat
  app.get("/api/lives/:id/comments", optionalAuth, async (req, res) => {
    const id = parseId(req.params.id);
    const after = req.query.after === undefined ? 0 : Number(req.query.after);
    if (!id || !Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: "Pedido inválido." });
    if (!(await loadLive(id, req.user?.id))) return res.status(404).json({ error: "Direto não encontrado." });
    const result = await pool.query(`
      SELECT * FROM (
        SELECT c.id,c.body,c.stars,c.created_at,u.username,u.display_name,u.avatar_url
        FROM live_comments c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.live_id=$1 AND c.id > $2 AND (c.user_id IS NULL OR NOT ${blockedBetween("$3", "c.user_id")})
        ORDER BY c.id DESC LIMIT 60
      ) recent ORDER BY id ASC`, [id, after, req.user?.id || 0]);
    res.json({ comments: result.rows });
  });

  app.post("/api/lives/:id/comments", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const body = cleanText(req.body?.body);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    if (!body || body.length > 300) return res.status(400).json({ error: "Escreve uma mensagem (até 300 caracteres)." });
    const live = await loadLive(id, req.user.id);
    if (!live || live.status !== "live") return res.status(409).json({ error: "Este direto já terminou." });
    const result = await pool.query("INSERT INTO live_comments(live_id,user_id,body) VALUES($1,$2,$3) RETURNING id", [id, req.user.id, body]);
    res.status(201).json({ id: result.rows[0].id });
  });

  // Estrelas durante o direto: mesmas regras das ofertas em publicações, e aparecem no chat.
  app.post("/api/lives/:id/stars", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const amount = Number(req.body?.amount);
    if (!id || !GIFT_AMOUNTS.includes(amount)) return res.status(400).json({ error: "Quantidade de estrelas inválida." });
    const live = await loadLive(id, req.user.id);
    if (!live || live.status !== "live") return res.status(409).json({ error: "Este direto já terminou." });
    if (live.host_id === req.user.id) return res.status(400).json({ error: "Não podes oferecer estrelas a ti próprio." });
    const outcome = await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(42, $1)", [req.user.id]);
      const balance = (await client.query(balanceSql, [req.user.id])).rows[0].balance;
      if (balance < amount) return { error: "Não tens estrelas suficientes.", balance };
      await client.query(
        "INSERT INTO star_ledger(user_id,amount,kind,counterpart_id,live_id) VALUES($1,$2,'gift_sent',$3,$4),($3,$5,'gift_received',$1,$4)",
        [req.user.id, -amount, live.host_id, id, amount]);
      await client.query("INSERT INTO live_comments(live_id,user_id,body,stars) VALUES($1,$2,$3,$4)",
        [id, req.user.id, `ofereceu ${amount} ${amount === 1 ? "estrela" : "estrelas"}`, amount]);
      return { balance: balance - amount };
    });
    if (outcome.error) return res.status(402).json(outcome);
    res.json(outcome);
  });

  // Sinalização WebRTC: o espectador envia a oferta a quem emite, e recebe a resposta.
  app.post("/api/lives/:id/signals", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const to = parseId(req.body?.to);
    const kind = req.body?.kind;
    const payload = typeof req.body?.payload === "string" ? req.body.payload : "";
    if (!id || !to || !["offer", "answer", "bye"].includes(kind) || payload.length > 20000) return res.status(400).json({ error: "Sinal inválido." });
    const live = await loadLive(id, req.user.id);
    if (!live || live.status !== "live") return res.status(409).json({ error: "Este direto já terminou." });
    const fromHost = req.user.id === live.host_id;
    // Só há conversa entre quem emite e um espectador (nunca entre espectadores).
    if (fromHost === (to === live.host_id) || (!fromHost && kind === "answer") || (fromHost && kind === "offer")) {
      return res.status(403).json({ error: "Sinal não permitido." });
    }
    await pool.query("INSERT INTO live_signals(live_id,from_user,to_user,kind,payload) VALUES($1,$2,$3,$4,$5)", [id, req.user.id, to, kind, payload]);
    res.status(201).json({ sent: true });
  });

  app.get("/api/lives/:id/signals", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const after = req.query.after === undefined ? 0 : Number(req.query.after);
    if (!id || !Number.isSafeInteger(after) || after < 0) return res.status(400).json({ error: "Pedido inválido." });
    await pool.query("DELETE FROM live_signals WHERE created_at < NOW() - INTERVAL '5 minutes'");
    const result = await pool.query(`
      SELECT id,from_user,kind,payload FROM live_signals
      WHERE live_id=$1 AND to_user=$2 AND id > $3 ORDER BY id LIMIT 50`, [id, req.user.id, after]);
    res.json({ signals: result.rows });
  });
}

module.exports = { MAX_VIDEO_VIEWERS, registerLiveRoutes, turnServer };
