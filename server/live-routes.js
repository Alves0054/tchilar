// Diretos (lives).
//
// Dois modos, escolhidos pela configuração do servidor:
//   - "cdn"  (MEDIA_* configurado): quem emite envia o vídeo uma vez para o MediaMTX (OBS por RTMP/WHIP
//            ou o estúdio do browser por WHIP); os espectadores recebem HLS através de uma CDN.
//            É o modo para milhares ou 100 mil+ espectadores. Ver server/media-server.js.
//   - "p2p"  (sem MEDIA_*): o vídeo vai do browser de quem emite para cada espectador (WebRTC),
//            no máximo MAX_VIDEO_VIEWERS ligações. Serve para desenvolvimento e diretos pequenos.
//
// Escala do resto (chat, estrelas, contagem): os espectadores leem um "feed" público por direto,
// guardado em memória 1 s e cacheável pela CDN 2 s, e o intervalo de leitura aumenta com a audiência.
// A presença é contada em memória (server/live-presence.js) em vez de uma escrita por espectador.
const crypto = require("crypto");
const { GIFT_AMOUNTS } = require("./growth");
const { LivePresence, pollInterval } = require("./live-presence");
const { LiveReactions } = require("./live-reactions");
const {
  authorizeMedia, createMediaClient, hashStreamKey, mediaConfig, newStreamKey, pathFor, publishToken, userFromPath
} = require("./media-server");

const HOST_TIMEOUT_SECONDS = 120;   // sem sinal de quem emite (página ou vídeo) há 2 min → o direto termina
// Espectadores dão sinal de vida a cada 30 s; em diretos grandes com menos frequência.
// 100 mil pessoas a cada 120 s ≈ 830 pedidos/s, que uma instância da API aguenta.
const viewerHeartbeatMs = viewers => (viewers < 5000 ? 30_000 : viewers < 50_000 ? 60_000 : 120_000);
// Modo lento do chat: tempo mínimo entre mensagens da mesma pessoa (mais longo com muita gente).
const chatSlowModeMs = viewers => (viewers < 5000 ? 2000 : 5000);
const MAX_VIDEO_VIEWERS = 8;        // modo p2p: ligações de vídeo diretas por emissão
const FEED_COMMENTS = 80;
const STUN = { urls: "stun:stun.cloudflare.com:3478" };
const TURN_TTL_SECONDS = 12 * 60 * 60;
const MAX_MODERATORS = 20;
const MUTE_MINUTES = [5, 10, 60];
const LIVE_CATEGORIES = ["conversa", "musica", "jogos", "desporto", "educacao", "negocios", "fe", "arte", "outro"];

// Servidor TURN (retransmissão). Com LIVE_TURN_SECRET (coturn "use-auth-secret"), cada pessoa recebe
// credenciais temporárias que expiram em 12 h — nunca a palavra-passe fixa do servidor.
// Com TURN configurado, o vídeo passa SEMPRE pela retransmissão ("relay"): ninguém vê o IP de casa
// ou do telemóvel de outra pessoa. LIVE_TURN_RELAY_ONLY=false volta a permitir ligações diretas.
function turnServer(userId, env, now = Date.now()) {
  const urls = String(env.LIVE_TURN_URL || "").split(",").map(url => url.trim()).filter(Boolean);
  if (!urls.length) return { iceServers: [STUN], iceTransportPolicy: "all" };
  let username = env.LIVE_TURN_USERNAME || "";
  let credential = env.LIVE_TURN_CREDENTIAL || "";
  if (env.LIVE_TURN_SECRET) {
    username = `${Math.floor(now / 1000) + TURN_TTL_SECONDS}:${userId}`;
    credential = crypto.createHmac("sha1", env.LIVE_TURN_SECRET).update(username).digest("base64");
  }
  const relayOnly = env.LIVE_TURN_RELAY_ONLY !== "false";
  return {
    iceServers: relayOnly ? [{ urls, username, credential }] : [STUN, { urls, username, credential }],
    iceTransportPolicy: relayOnly ? "relay" : "all"
  };
}

// Valida os detalhes de um novo direto.
function parseLiveInput(input, { mediaEnabled }) {
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const title = clean(input?.title);
  const description = String(input?.description ?? "").replace(/\r\n/g, "\n").trim();
  const category = clean(input?.category);
  const source = input?.source === "obs" ? "obs" : "browser";
  if (!title || title.length > 120) return { error: "Dá um título ao direto (até 120 caracteres)." };
  if (description.length > 500) return { error: "A descrição pode ter até 500 caracteres." };
  if (category && !LIVE_CATEGORIES.includes(category)) return { error: "Categoria inválida." };
  if (source === "obs" && !mediaEnabled) return { error: "Este servidor ainda não aceita programas de transmissão (falta configurar o servidor de vídeo)." };
  return { live: { title, description, category, source } };
}

const balanceSql = "SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS balance FROM star_ledger WHERE user_id=$1";

function registerLiveRoutes(app, deps) {
  const { pool, auth, optionalAuth, parseId, isRecord, cleanText, transaction, blockedBetween, rateLimit, env = process.env } = deps;
  const presenceAuth = deps.presenceAuth || auth;
  const config = mediaConfig(env);
  const media = config ? createMediaClient(config) : null;
  const presence = new LivePresence({ windowMs: viewerHeartbeatMs(Infinity) * 2.5 });
  const reactions = new LiveReactions();

  // Quem pode moderar um direto: quem emite e os moderadores que essa pessoa escolheu.
  async function moderationRole(live, userId) {
    if (live.host_id === userId) return "host";
    const mod = await pool.query("SELECT 1 FROM live_moderators WHERE host_id=$1 AND moderator_id=$2", [live.host_id, userId]);
    return mod.rowCount ? "moderator" : null;
  }
  const turnConfig = userId => turnServer(userId, env);

  const endStaleLives = () => pool.query(`
    UPDATE lives SET status='ended', ended_at=NOW()
    WHERE status='live' AND host_seen_at < NOW() - make_interval(secs => $1)`, [HOST_TIMEOUT_SECONDS]);

  const LIVE_FIELDS = `l.id,l.title,l.description,l.category,l.source,l.status,l.started_at,l.ended_at,l.peak_viewers,l.unique_viewers,l.current_viewers,
    u.id AS host_id,u.username,u.display_name,u.avatar_url,u.partner_since IS NOT NULL AS is_verified,
    (SELECT COALESCE(SUM(s.amount),0) FROM star_ledger s WHERE s.live_id=l.id AND s.kind='gift_received')::int AS stars`;

  // Esta cópia da API conta o direto (o nginx manda sempre o mesmo direto para a mesma cópia)?
  // Se não, usa o número que a outra cópia gravou há no máximo 15 s.
  const viewersOf = live => (presence.lives.has(live.id) ? presence.count(live.id) : Number(live.current_viewers) || 0);
  const withViewers = live => live && ({ ...live, viewers: live.status === "live" ? viewersOf(live) : 0, current_viewers: undefined });

  // Quem pode ver: o direto existe e não há bloqueio entre as duas pessoas.
  async function loadLive(id, viewerId) {
    const result = await pool.query(
      `SELECT ${LIVE_FIELDS} FROM lives l JOIN users u ON u.id=l.host_id
       WHERE l.id=$1 AND NOT ${blockedBetween("$2", "l.host_id")}`, [id, viewerId || 0]);
    return withViewers(result.rows[0] || null);
  }

  // Estado leve de um direto, partilhado por todos durante 1 s (sinais de vida de milhares de pessoas).
  const statusCache = new Map();
  const blockChecks = new Map(); // "liveId:userId" → { ok, at }
  async function liveStatus(id) {
    const cached = statusCache.get(id);
    if (cached && Date.now() - cached.at < 1000) return cached.value;
    const result = await pool.query("SELECT id,host_id,status FROM lives WHERE id=$1", [id]);
    const value = result.rows[0] || null;
    statusCache.set(id, { value, at: Date.now() });
    return value;
  }

  const playbackFor = live => media && live.status === "live" ? { hls: media.hlsUrl(live.host_id) } : null;
  const signalFor = live => {
    const state = media?.state.get(pathFor(live.host_id));
    return state ? { ready: state.ready, width: state.width, height: state.height, kbps: state.kbps } : { ready: false };
  };

  app.get("/api/lives/config", optionalAuth, (req, res) => {
    const { iceServers, iceTransportPolicy } = req.user ? turnConfig(req.user.id) : { iceServers: [STUN], iceTransportPolicy: "all" };
    res.json({
      mode: media ? "cdn" : "p2p", iceServers, iceTransportPolicy, maxVideoViewers: MAX_VIDEO_VIEWERS,
      giftAmounts: GIFT_AMOUNTS, categories: LIVE_CATEGORIES, obs: Boolean(media), browserPublish: Boolean(media && config.whipUrl)
    });
  });

  app.get("/api/lives", optionalAuth, async (req, res) => {
    await endStaleLives();
    const result = await pool.query(`
      SELECT ${LIVE_FIELDS} FROM lives l JOIN users u ON u.id=l.host_id
      WHERE l.status='live' AND NOT ${blockedBetween("$1", "l.host_id")}
      ORDER BY (l.host_id=$1) DESC, l.started_at DESC LIMIT 50`, [req.user?.id || 0]);
    const lives = result.rows.map(withViewers).sort((a, b) =>
      Number(b.host_id === req.user?.id) - Number(a.host_id === req.user?.id) || b.viewers - a.viewers);
    res.json({ lives });
  });

  // ----- Chave de transmissão (OBS, vMix, Streamlabs, encoders e placas com RTMP) -----
  const streamKeyInfo = (userId, row, key = null) => ({
    enabled: Boolean(media),
    hasKey: Boolean(row?.stream_key_hash),
    createdAt: row?.stream_key_created_at || null,
    rtmp: media && config.rtmpUrl ? { server: `${config.rtmpUrl}/live`, streamKey: key ? `u${userId}?key=${key}` : null } : null,
    whip: media && config.whipUrl ? { url: media.whipUrl(userId), token: key } : null
  });

  app.get("/api/lives/stream-key", auth, async (req, res) => {
    const result = await pool.query("SELECT stream_key_hash,stream_key_created_at FROM users WHERE id=$1", [req.user.id]);
    res.json(streamKeyInfo(req.user.id, result.rows[0]));
  });

  // Gera (ou troca) a chave. É mostrada só agora; a antiga deixa de funcionar e a emissão atual é cortada.
  app.post("/api/lives/stream-key", auth, ...(rateLimit ? [rateLimit] : []), async (req, res) => {
    if (!media) return res.status(503).json({ error: "O servidor de vídeo ainda não está configurado." });
    const key = newStreamKey();
    const result = await pool.query(
      "UPDATE users SET stream_key_hash=$2,stream_key_created_at=NOW() WHERE id=$1 RETURNING stream_key_hash,stream_key_created_at",
      [req.user.id, hashStreamKey(key)]);
    await media.kick(pathFor(req.user.id)).catch(() => false);
    res.status(201).json(streamKeyInfo(req.user.id, result.rows[0], key));
  });

  // ----- Moderadores (valem para todos os diretos de quem os escolhe) -----
  app.get("/api/lives/moderators", auth, async (req, res) => {
    const result = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url FROM live_moderators m JOIN users u ON u.id=m.moderator_id
      WHERE m.host_id=$1 ORDER BY m.created_at`, [req.user.id]);
    res.json({ moderators: result.rows, max: MAX_MODERATORS });
  });

  app.post("/api/lives/moderators", auth, async (req, res) => {
    const username = cleanText(req.body?.username).replace(/^@/, "").toLowerCase();
    if (!username) return res.status(400).json({ error: "Indica o nome de utilizador." });
    const person = await pool.query(`SELECT id,username,display_name,avatar_url FROM users
      WHERE LOWER(username)=$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$2", "id")}`, [username, req.user.id]);
    const moderator = person.rows[0];
    if (!moderator) return res.status(404).json({ error: "Não encontrámos essa pessoa." });
    if (moderator.id === req.user.id) return res.status(400).json({ error: "Já moderas os teus diretos." });
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM live_moderators WHERE host_id=$1", [req.user.id]);
    if (count.rows[0].n >= MAX_MODERATORS) return res.status(409).json({ error: `Podes ter até ${MAX_MODERATORS} moderadores.` });
    await pool.query("INSERT INTO live_moderators(host_id,moderator_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, moderator.id]);
    feedCache.clear();
    res.status(201).json({ moderator });
  });

  app.delete("/api/lives/moderators/:userId", auth, async (req, res) => {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Pessoa inválida." });
    await pool.query("DELETE FROM live_moderators WHERE host_id=$1 AND moderator_id=$2", [req.user.id, userId]);
    feedCache.clear();
    res.json({ removed: true });
  });

  app.post("/api/lives", auth, async (req, res) => {
    const parsed = parseLiveInput(isRecord(req.body) ? req.body : {}, { mediaEnabled: Boolean(media) });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { title, description, category, source } = parsed.live;
    await endStaleLives();
    let live;
    try {
      live = (await pool.query("INSERT INTO lives(host_id,title,description,category,source) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [req.user.id, title, description, category, source])).rows[0];
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
    const isHost = Boolean(req.user && req.user.id === live.host_id);
    res.json({
      live: { ...live, is_host: isHost, playback: playbackFor(live), ...(isHost ? { signal: signalFor(live), stats: presence.stats(id) } : {}) },
      supporters: supporters.rows
    });
  });

  // Estúdio no browser em modo cdn: endereço WHIP com um token temporário só para esta pessoa.
  app.post("/api/lives/:id/publish", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!media || !config.whipUrl) return res.status(409).json({ error: "Este servidor usa o modo direto (sem servidor de vídeo)." });
    const live = id && await liveStatus(id);
    if (!live || live.host_id !== req.user.id || live.status !== "live") return res.status(404).json({ error: "Direto não encontrado." });
    res.json({ whip: `${media.whipUrl(req.user.id)}?t=${encodeURIComponent(publishToken(req.user.id, config.secret))}` });
  });

  // Sinal de vida: quem emite mantém o direto ativo; espectadores contam como "a ver" (em memória).
  app.post("/api/lives/:id/heartbeat", presenceAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    const live = await liveStatus(id);
    if (!live) return res.status(404).json({ error: "Direto não encontrado." });
    if (live.status !== "live") return res.json({ status: live.status, viewers: 0 });
    const viewers = presence.count(id);
    if (live.host_id === req.user.id) {
      await pool.query("UPDATE lives SET host_seen_at=NOW() WHERE id=$1", [id]);
      return res.json({ status: live.status, viewers, stats: presence.stats(id), signal: media ? signalFor(live) : null });
    }
    // Quem tem bloqueio com quem emite não conta como espectador (verificado uma vez por minuto).
    const blockKey = `${id}:${req.user.id}`;
    let allowed = blockChecks.get(blockKey);
    if (!allowed || Date.now() - allowed.at > 60_000) {
      const visible = await pool.query(`SELECT 1 FROM lives l WHERE l.id=$1 AND NOT ${blockedBetween("$2", "l.host_id")}`, [id, req.user.id]);
      allowed = { ok: visible.rowCount > 0, at: Date.now() };
      if (blockChecks.size > 200_000) blockChecks.clear();
      blockChecks.set(blockKey, allowed);
    }
    if (!allowed.ok) return res.status(404).json({ error: "Direto não encontrado." });
    presence.touch(id, req.user.id);
    const now = presence.count(id);
    res.json({ status: live.status, viewers: now, next: viewerHeartbeatMs(now) });
  });

  app.post("/api/lives/:id/leave", presenceAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (id) presence.leave(id, req.user.id);
    res.json({ left: true });
  });

  app.post("/api/lives/:id/end", auth, async (req, res) => {
    const id = parseId(req.params.id);
    const stats = presence.stats(id);
    const result = await pool.query(`
      UPDATE lives SET status='ended', ended_at=NOW(), peak_viewers=GREATEST(peak_viewers,$3), unique_viewers=GREATEST(unique_viewers,$4)
      WHERE id=$1 AND host_id=$2 AND status='live' RETURNING peak_viewers,unique_viewers,started_at,ended_at`, [id, req.user.id, stats.peak, stats.unique]);
    if (!result.rowCount) return res.status(409).json({ error: "Este direto já terminou." });
    statusCache.delete(id);
    feedCache.delete(id);
    presence.forget(id);
    reactions.forget(id);
    if (media) await media.kick(pathFor(req.user.id)).catch(() => false);
    res.json({ status: "ended", ...result.rows[0] });
  });

  // ----- Feed público do direto: chat, estrelas e espectadores numa só resposta -----
  // Igual para toda a gente, por isso fica 1 s em memória e a CDN pode guardá-lo 2 s:
  // 100 mil pessoas a ler o chat custam poucos pedidos por segundo à base de dados.
  // Quem bloqueaste é escondido no teu browser (o feed não depende de quem pede).
  // É público de propósito: tem o mesmo que vê alguém sem sessão (o vídeo também é aberto), e só assim
  // a CDN o pode guardar. Os bloqueios são aplicados ao entrar na sala (GET /api/lives/:id devolve 404),
  // ao contar espectadores (heartbeat), ao escrever no chat e ao oferecer estrelas.
  const feedCache = new Map();
  const lastMessage = new Map(); // userId → última mensagem no chat (modo lento)
  async function buildFeed(id) {
    const cached = feedCache.get(id);
    if (cached && Date.now() - cached.at < 1000) return cached.value;
    const [live, comments, supporters] = await Promise.all([
      pool.query(`SELECT l.id,l.status,l.host_id,
        (SELECT COALESCE(SUM(s.amount),0) FROM star_ledger s WHERE s.live_id=l.id AND s.kind='gift_received')::int AS stars,
        (SELECT json_build_object('id',c.id,'body',c.body,'username',u.username,'display_name',u.display_name,'avatar_url',u.avatar_url)
          FROM live_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=l.pinned_comment_id AND c.hidden_at IS NULL) AS pinned,
        (SELECT COALESCE(json_agg(u.username), '[]'::json) FROM live_moderators m JOIN users u ON u.id=m.moderator_id WHERE m.host_id=l.host_id) AS moderators,
        (SELECT username FROM users WHERE id=l.host_id) AS host_username
        FROM lives l WHERE l.id=$1`, [id]),
      pool.query(`
        SELECT * FROM (
          SELECT c.id,c.body,c.stars,c.created_at,u.id AS user_id,u.username,u.display_name,u.avatar_url
          FROM live_comments c LEFT JOIN users u ON u.id=c.user_id
          WHERE c.live_id=$1 AND c.hidden_at IS NULL ORDER BY c.id DESC LIMIT ${FEED_COMMENTS}
        ) recent ORDER BY id ASC`, [id]),
      pool.query(`
        SELECT u.username,u.display_name,u.avatar_url,SUM(s.amount)::int AS stars
        FROM star_ledger s JOIN users u ON u.id=s.counterpart_id
        WHERE s.live_id=$1 AND s.kind='gift_received' GROUP BY u.id ORDER BY SUM(s.amount) DESC LIMIT 5`, [id])
    ]);
    const row = live.rows[0];
    const viewers = row?.status === "live" ? presence.count(id) : 0;
    const value = row ? {
      status: row.status, stars: row.stars, viewers, poll: pollInterval(viewers),
      supporters: supporters.rows, comments: comments.rows, pinned: row.pinned,
      host: row.host_username, moderators: row.moderators, reactions: reactions.of(id)
    } : null;
    feedCache.set(id, { value, at: Date.now() });
    return value;
  }

  app.get("/api/lives/:id/feed", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    const feed = await buildFeed(id);
    if (!feed) return res.status(404).json({ error: "Direto não encontrado." });
    res.set("Cache-Control", feed.status === "live" ? "public, max-age=1, s-maxage=2" : "public, max-age=30, s-maxage=60");
    res.json(feed);
  });

  // Chat (leitura antiga, por pessoa; mantida para compatibilidade).
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
    const wait = chatSlowModeMs(presence.count(id));
    const lastSent = lastMessage.get(req.user.id) || 0;
    if (Date.now() - lastSent < wait) {
      return res.status(429).json({ error: `Modo lento: espera ${Math.ceil((wait - (Date.now() - lastSent)) / 1000)} s entre mensagens.` });
    }
    const live = await loadLive(id, req.user.id);
    if (!live || live.status !== "live") return res.status(409).json({ error: "Este direto já terminou." });
    const muted = await pool.query("SELECT until FROM live_mutes WHERE live_id=$1 AND user_id=$2 AND (until IS NULL OR until > NOW())", [id, req.user.id]);
    if (muted.rowCount) {
      const until = muted.rows[0].until;
      return res.status(403).json({ error: until
        ? `A moderação não te deixa escrever neste chat até às ${new Date(until).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" })}.`
        : "A moderação não te deixa escrever no chat deste direto." });
    }
    lastMessage.set(req.user.id, Date.now());
    if (lastMessage.size > 200_000) lastMessage.clear();
    const result = await pool.query("INSERT INTO live_comments(live_id,user_id,body) VALUES($1,$2,$3) RETURNING id", [id, req.user.id, body]);
    // Com muita gente, o feed é reconstruído no máximo uma vez por segundo (não a cada mensagem).
    if (presence.count(id) < 500) feedCache.delete(id);
    res.status(201).json({ id: result.rows[0].id });
  });

  // ----- Reações rápidas (em memória; ver server/live-reactions.js) -----
  app.post("/api/lives/:id/react", presenceAuth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Direto inválido." });
    const live = await liveStatus(id);
    if (!live || live.status !== "live") return res.status(409).json({ error: "Este direto já terminou." });
    // Só reage quem está a ver (deu sinal de vida e passou a verificação de bloqueio) ou quem emite.
    if (!presence.lives.get(id)?.seen.has(req.user.id) && live.host_id !== req.user.id) {
      return res.status(403).json({ error: "Abre o direto para reagir." });
    }
    res.status(202).json({ counted: reactions.add(id, req.user.id, req.body?.kind) });
  });

  // ----- Moderação: apagar, fixar e silenciar (quem emite e os seus moderadores) -----
  async function moderatedLive(req, res) {
    const id = parseId(req.params.id);
    const live = id && await liveStatus(id);
    if (!live) { res.status(404).json({ error: "Direto não encontrado." }); return null; }
    const role = await moderationRole(live, req.user.id);
    if (!role) { res.status(403).json({ error: "Só quem emite e os moderadores podem fazer isto." }); return null; }
    return { id, live, role };
  }

  app.delete("/api/lives/:id/comments/:commentId", auth, async (req, res) => {
    const context = await moderatedLive(req, res);
    if (!context) return;
    const commentId = parseId(req.params.commentId);
    const result = await pool.query(
      "UPDATE live_comments SET hidden_at=NOW(), hidden_by=$3 WHERE id=$1 AND live_id=$2 AND hidden_at IS NULL RETURNING id",
      [commentId, context.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Mensagem não encontrada." });
    feedCache.delete(context.id);
    res.json({ hidden: true });
  });

  app.post("/api/lives/:id/pin", auth, async (req, res) => {
    const context = await moderatedLive(req, res);
    if (!context) return;
    const commentId = req.body?.commentId === null ? null : parseId(req.body?.commentId);
    if (commentId !== null) {
      const comment = await pool.query("SELECT 1 FROM live_comments WHERE id=$1 AND live_id=$2 AND hidden_at IS NULL AND stars=0", [commentId, context.id]);
      if (!comment.rowCount) return res.status(404).json({ error: "Mensagem não encontrada." });
    }
    await pool.query("UPDATE lives SET pinned_comment_id=$2 WHERE id=$1", [context.id, commentId]);
    feedCache.delete(context.id);
    res.json({ pinned: commentId });
  });

  app.post("/api/lives/:id/mute", auth, async (req, res) => {
    const context = await moderatedLive(req, res);
    if (!context) return;
    const minutes = req.body?.minutes === null ? null : Number(req.body?.minutes);
    if (minutes !== null && !MUTE_MINUTES.includes(minutes)) return res.status(400).json({ error: "Duração inválida." });
    const target = await pool.query("SELECT id FROM users WHERE username=$1", [cleanText(req.body?.username)]);
    const userId = target.rows[0]?.id;
    if (!userId) return res.status(404).json({ error: "Pessoa não encontrada." });
    if (await moderationRole(context.live, userId)) return res.status(403).json({ error: "Não podes silenciar quem emite nem moderadores." });
    await pool.query(`
      INSERT INTO live_mutes(live_id,user_id,until,muted_by)
      VALUES($1,$2,CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() + make_interval(mins => $3::int) END,$4)
      ON CONFLICT(live_id,user_id) DO UPDATE SET until=EXCLUDED.until, muted_by=EXCLUDED.muted_by, created_at=NOW()`,
    [context.id, userId, minutes, req.user.id]);
    res.json({ muted: true, minutes });
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
    feedCache.delete(id);
    res.json(outcome);
  });

  // ----- Modo p2p: sinalização WebRTC entre quem emite e cada espectador -----
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

  // ----- Autorização pedida pelo MediaMTX (authMethod: http) -----
  // O segredo vai no URL configurado no MediaMTX; esta rota não serve para mais nada.
  const liveOnCache = new Map();
  const lookups = {
    publisher: async userId => (await pool.query("SELECT stream_key_hash,suspended_at FROM users WHERE id=$1", [userId])).rows[0] || null,
    liveOn: async userId => {
      const cached = liveOnCache.get(userId);
      if (cached && Date.now() - cached.at < 5000) return cached.value;
      const value = (await pool.query("SELECT id FROM lives WHERE host_id=$1 AND status='live'", [userId])).rows[0] || null;
      liveOnCache.set(userId, { value, at: Date.now() });
      return value;
    }
  };
  app.post("/api/media/auth", async (req, res) => {
    const given = String(req.query.secret || "");
    if (!config || given.length !== config.secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.secret))) {
      return res.status(404).end();
    }
    if (req.body?.action === "publish") liveOnCache.delete(userFromPath(req.body.path));
    const decision = await authorizeMedia(req.body, config.secret, lookups);
    res.status(decision.ok ? 200 : 401).json(decision);
  });

  // ----- Manutenção a cada 5 s: presença, estado do vídeo, pico de audiência -----
  let ticks = 0;
  const maintain = async () => {
    ticks += 1;
    const snapshot = presence.prune();
    if (media) {
      await media.refresh().catch(() => null);
      // Enquanto o vídeo chega ao MediaMTX, o direto continua (mesmo com o estúdio fechado).
      const ready = [...media.state].filter(([, state]) => state.ready).map(([path]) => userFromPath(path)).filter(Boolean);
      if (ready.length) {
        const open = await pool.query(
          "UPDATE lives SET host_seen_at=NOW() WHERE status='live' AND host_id = ANY($1::int[]) RETURNING host_id", [ready]);
        const hosts = new Set(open.rows.map(row => row.host_id));
        // Vídeo a chegar sem direto aberto (terminado ou chave antiga): corta a emissão.
        for (const userId of ready) if (!hosts.has(userId)) await media.kick(pathFor(userId)).catch(() => false);
      }
    }
    if (ticks % 3 === 0 && snapshot.length) {
      const ended = await pool.query(`
        UPDATE lives l SET peak_viewers=GREATEST(l.peak_viewers,s.peak), unique_viewers=GREATEST(l.unique_viewers,s.uniq),
          current_viewers=CASE WHEN l.status='live' THEN s.now ELSE 0 END
        FROM unnest($1::int[], $2::int[], $3::int[], $4::int[]) AS s(id,peak,uniq,now)
        WHERE l.id=s.id RETURNING l.id,l.status`,
      [snapshot.map(item => item.liveId), snapshot.map(item => item.peak), snapshot.map(item => item.unique), snapshot.map(item => item.viewers)]);
      for (const row of ended.rows) if (row.status === "ended") presence.forget(row.id);
    }
  };
  if (deps.startMaintenance !== false) {
    const timer = setInterval(() => { maintain().catch(error => console.warn("Manutenção dos diretos:", error.message)); }, 5000);
    timer.unref();
  }
  return { presence, maintain, media };
}

module.exports = { LIVE_CATEGORIES, MAX_VIDEO_VIEWERS, parseLiveInput, registerLiveRoutes, turnServer };
