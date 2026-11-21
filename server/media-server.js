// Servidor de média (MediaMTX) para diretos com muitos espectadores.
//
// Quem emite envia o vídeo UMA vez para o MediaMTX:
//   - OBS, vMix, Streamlabs... por RTMP (servidor + chave) ou WHIP (URL + bearer token);
//   - o estúdio no browser (câmara, placa de captura, ecrã) por WHIP com um token temporário.
// O MediaMTX converte para HLS, que é servido através de uma CDN: é a CDN que entrega o vídeo
// a milhares (ou 100 mil+) de pessoas, porque cada segmento é pedido à origem uma só vez.
//
// O MediaMTX pergunta a esta API se cada ação é permitida (authMethod: http). Ver deploy/mediamtx.yml.
const crypto = require("crypto");

const LIVE_PATH = /^live\/u([1-9]\d{0,9})$/;
const PUBLISH_TOKEN_TTL_SECONDS = 6 * 60 * 60;

const trimSlash = value => String(value || "").trim().replace(/\/+$/, "");

// Sem MEDIA_API_URL, MEDIA_HLS_URL e MEDIA_HOOK_SECRET o Tchilar usa o modo direto (WebRTC, até 8 pessoas).
function mediaConfig(env) {
  const apiUrl = trimSlash(env.MEDIA_API_URL);
  const hlsUrl = trimSlash(env.MEDIA_HLS_URL);
  const secret = String(env.MEDIA_HOOK_SECRET || "");
  if (!apiUrl || !hlsUrl || secret.length < 16) return null;
  return { apiUrl, hlsUrl, secret, whipUrl: trimSlash(env.MEDIA_WHIP_URL), rtmpUrl: trimSlash(env.MEDIA_RTMP_URL) };
}

const pathFor = userId => `live/u${userId}`;
const userFromPath = path => {
  const match = LIVE_PATH.exec(String(path || ""));
  return match ? Number(match[1]) : null;
};

const newStreamKey = () => `sk_${crypto.randomBytes(24).toString("base64url")}`;
const hashStreamKey = key => crypto.createHash("sha256").update(String(key)).digest("hex");

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Token de emissão do estúdio no browser: "userId.expira.assinatura", válido 6 h e só para aquele caminho.
function publishToken(userId, secret, now = Date.now()) {
  const payload = `${userId}.${Math.floor(now / 1000) + PUBLISH_TOKEN_TTL_SECONDS}`;
  const signature = crypto.createHmac("sha256", secret).update(`publish:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyPublishToken(token, userId, secret, now = Date.now()) {
  const [id, expires, signature] = String(token || "").split(".");
  if (!signature || Number(id) !== userId || !(Number(expires) > now / 1000)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`publish:${id}.${expires}`).digest("base64url");
  return safeEqual(signature, expected);
}

// Diretos pagos: o vídeo (HLS) só abre com um token de leitura que a API dá a quem pagou a entrada.
// "liveId.userId.expira.assinatura", válido 3 h e ligado a quem pagou: a cada pedido o MediaMTX pergunta à API,
// que confirma que essa pessoa ainda tem bilhete (ou modera). Um token partilhado fica sempre ligado a quem o
// comprou, e deixa de abrir se o bilhete for retirado. A CDN tem de passar a query (?v=) à origem nos .m3u8.
const READ_TOKEN_TTL_SECONDS = 3 * 60 * 60;
function readToken(liveId, userId, secret, now = Date.now()) {
  const payload = `${liveId}.${userId}.${Math.floor(now / 1000) + READ_TOKEN_TTL_SECONDS}`;
  return `${payload}.${crypto.createHmac("sha256", secret).update(`read:${payload}`).digest("base64url")}`;
}
// Devolve o userId do token quando é válido para aquele direto; senão null.
function verifyReadToken(token, liveId, secret, now = Date.now()) {
  const [id, userId, expires, signature] = String(token || "").split(".");
  if (!signature || Number(id) !== liveId || !(Number(expires) > now / 1000) || !(Number(userId) > 0)) return null;
  const expected = crypto.createHmac("sha256", secret).update(`read:${id}.${userId}.${expires}`).digest("base64url");
  return safeEqual(signature, expected) ? Number(userId) : null;
}

// Decide um pedido de autorização do MediaMTX.
// lookups.publisher(userId) → { stream_key_hash, suspended_at } | null
// lookups.liveOn(userId) → o direto aberto dessa pessoa (ou null)
// A API de controlo do MediaMTX (listar e cortar emissões) só aceita a app do Tchilar:
// utilizador fixo e o MEDIA_HOOK_SECRET como palavra-passe. Nunca fica aberta na rede interna.
const MEDIA_API_USER = "tchilar-api";

async function authorizeMedia(request, secret, lookups, now = Date.now()) {
  if (request?.action === "api") {
    return request.user === MEDIA_API_USER && safeEqual(request.password || "", secret)
      ? { ok: true }
      : { ok: false, reason: "API reservada à app" };
  }
  const userId = userFromPath(request?.path);
  if (!userId) return { ok: false, reason: "caminho inválido" };
  const query = new URLSearchParams(String(request.query || ""));

  if (request.action === "read") {
    const live = await lookups.liveOn(userId);
    if (!live) return { ok: false, reason: "sem direto aberto" };
    if (live.entry_stars > 0) {
      const viewerId = verifyReadToken(query.get("v"), live.id, secret, now);
      if (!viewerId) return { ok: false, reason: "direto pago: falta o bilhete" };
      if (lookups.canWatch && !(await lookups.canWatch(live, viewerId))) return { ok: false, reason: "direto pago: bilhete retirado" };
    }
    return { ok: true };
  }
  if (request.action !== "publish") return { ok: false, reason: "ação não permitida" };

  const token = query.get("t");
  let allowed = Boolean(token) && verifyPublishToken(token, userId, secret, now);
  if (!allowed) {
    // OBS: a chave vem na query (RTMP "u12?key=...") ou como bearer token (WHIP).
    const key = query.get("key") || request.token || request.password || "";
    const publisher = key ? await lookups.publisher(userId) : null;
    allowed = Boolean(publisher?.stream_key_hash) && !publisher.suspended_at && safeEqual(hashStreamKey(key), publisher.stream_key_hash);
  }
  if (!allowed) return { ok: false, reason: "chave inválida" };
  return (await lookups.liveOn(userId)) ? { ok: true } : { ok: false, reason: "cria primeiro o direto no Tchilar" };
}

// Estado de cada caminho no MediaMTX (sinal a chegar, resolução, kbps).
function summarizePath(item, previous, now = Date.now()) {
  const video = (item.tracks2 || []).find(track => track.codecProps?.width) || null;
  const bytes = Number(item.bytesReceived ?? item.inboundBytes ?? 0);
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  const kbps = previous && seconds > 0 && bytes >= previous.bytes ? Math.round(((bytes - previous.bytes) * 8) / 1000 / seconds) : previous?.kbps || 0;
  return {
    ready: Boolean(item.ready),
    width: video?.codecProps.width || null,
    height: video?.codecProps.height || null,
    codecs: (item.tracks2 || []).map(track => track.codec),
    source: item.source || null,
    bytes, kbps, at: now
  };
}

const KICK_ENDPOINTS = { rtmpConn: "rtmpconns", webRTCSession: "webrtcsessions", rtspSession: "rtspsessions", srtConn: "srtconns" };

function createMediaClient(config, fetchImpl = fetch) {
  const state = new Map();
  const authorization = `Basic ${Buffer.from(`${MEDIA_API_USER}:${config.secret}`).toString("base64")}`;
  const call = (url, options = {}) => fetchImpl(url, { ...options, headers: { ...(options.headers || {}), Authorization: authorization } });
  return {
    state,
    // Lê todos os caminhos de uma vez (uma chamada por ciclo, não por espectador).
    async refresh(now = Date.now()) {
      const response = await call(`${config.apiUrl}/v3/paths/list?itemsPerPage=1000`);
      if (!response.ok) throw new Error(`MediaMTX respondeu ${response.status}`);
      const { items = [] } = /** @type {{ items?: any[] }} */ (await response.json());
      const seen = new Set();
      for (const item of items) {
        seen.add(item.name);
        state.set(item.name, summarizePath(item, state.get(item.name), now));
      }
      for (const name of state.keys()) if (!seen.has(name)) state.delete(name);
      return state;
    },
    // Corta a emissão (direto terminado ou conta suspensa).
    async kick(path) {
      const source = state.get(path)?.source;
      const endpoint = source && KICK_ENDPOINTS[source.type];
      if (!endpoint) return false;
      const response = await call(`${config.apiUrl}/v3/${endpoint}/kick/${encodeURIComponent(source.id)}`, { method: "POST" });
      return response.ok;
    },
    hlsUrl: userId => `${config.hlsUrl}/${pathFor(userId)}/index.m3u8`,
    whipUrl: userId => config.whipUrl ? `${config.whipUrl}/${pathFor(userId)}/whip` : ""
  };
}

module.exports = {
  MEDIA_API_USER,
  PUBLISH_TOKEN_TTL_SECONDS, authorizeMedia, createMediaClient, hashStreamKey, mediaConfig, newStreamKey,
  pathFor, publishToken, summarizePath, userFromPath, verifyPublishToken, readToken, verifyReadToken };
