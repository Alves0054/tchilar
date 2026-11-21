// Notificações push para a app (iOS e Android) através do serviço de push do Expo, e para o site
// (web push: Chrome, Edge, Firefox, Safari) com as chaves VAPID do Tchilar.
// O Expo entrega ao APNs (Apple) e ao FCM (Google); no servidor só é preciso o token de cada telemóvel.
// No browser, cada subscrição traz o endereço do serviço de push do browser e as chaves para cifrar o aviso.
//
// Como funciona: todas as notificações já ficam na tabela "notifications" (gostos, comentários, mensagens,
// diretos, pagamentos...). Um ciclo curto apanha as novas (pushed_at IS NULL), marca-as e envia-as para os
// telemóveis da pessoa. Marcar e enviar no mesmo passo (FOR UPDATE SKIP LOCKED) faz com que duas cópias da
// API nunca enviem o mesmo aviso duas vezes.
const crypto = require("node:crypto");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEVICE_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$/;
const MAX_TOKENS_PER_USER = 10;
const FRESH_MINUTES = 10; // avisos mais antigos (ex.: servidor esteve parado) já não vão para o telemóvel
// Web push: o servidor só envia para os serviços de push dos browsers (nunca para um endereço qualquer).
const WEB_PUSH_HOST = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const WEB_PUSH_KEY = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
const MAX_BROWSERS_PER_USER = 10;
const SESSION_IDLE_DAYS = 180;

// Para onde a app abre ao tocar no aviso (ecrãs da app, não do site).
function pushPath(row) {
  if (row.type === "message" && row.actor_id) return `/chat/${row.actor_id}`;
  if (row.type === "live") return "/live";
  if (["campaign", "payout", "ad"].includes(row.type)) return "/creator";
  if (["stars", "referral", "challenge"].includes(row.type)) return "/stars";
  if (row.type === "payment") return "/settings/pagamentos";
  if (row.type === "privacy") return /^Novo início de sessão/.test(row.text || "") ? "/settings/seguranca" : "/settings/conta";
  if (row.call_id) return `/call/direct/${row.call_id}`;
  if (row.post_id) return `/post/${row.post_id}`;
  if (row.group_id) return `/group/${row.group_id}`;
  if (row.actor_username) return `/u/${row.actor_username}`;
  return "/notifications";
}

// Para onde o site abre ao clicar no aviso (as mesmas regras de notificationPath em src/modules/notifications.jsx).
function sitePath(row) {
  if (row.type === "message" && row.actor_id) return `/messages/${row.actor_id}`;
  if (row.type === "live") return "/live";
  if (row.type === "campaign") return "/creator/parcerias";
  if (row.type === "payout") return "/creator/ganhos";
  if (row.type === "ad") return "/creator/anuncios";
  if (["stars", "referral", "challenge"].includes(row.type)) return "/estrelas";
  if (row.type === "payment") return "/settings/pagamentos";
  if (row.type === "privacy") return /^Novo início de sessão/.test(row.text || "") ? "/settings/seguranca" : "/settings/conta";
  if (row.call_id) return `/calls/${row.call_id}`;
  if (row.post_id) return `/posts/${row.post_id}`;
  if (row.group_id) return `/groups/${row.group_id}`;
  if (row.actor_username) return `/u/${row.actor_username}`;
  return "/notifications";
}

// Conteúdo do aviso no browser (o service worker em public/sw.js mostra-o).
function buildWebPayload(row) {
  return JSON.stringify({
    title: row.actor_name || "Tchilar",
    body: String(row.text || "").slice(0, 180),
    url: sitePath(row),
    tag: `n${row.id}`
  });
}

// Subscrição de um browser, como o browser a dá (PushSubscription.toJSON()). Devolve null se não for válida.
function parseWebSubscription(body) {
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const keys = body?.keys && typeof body.keys === "object" ? body.keys : {};
  if (!endpoint || endpoint.length > 1000) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== "https:" || url.port || url.username || !WEB_PUSH_HOST.test(url.hostname)) return null;
  if (!WEB_PUSH_KEY.test(String(keys.p256dh || "")) || !WEB_PUSH_KEY.test(String(keys.auth || ""))) return null;
  return { endpoint: url.toString(), p256dh: keys.p256dh, auth: keys.auth };
}

// Envio real com a biblioteca web-push (só existe com as chaves VAPID no .env).
function createWebPushSender({ publicKey, privateKey, subject }) {
  if (!publicKey || !privateKey) return null;
  const webpush = require("web-push");
  const vapidDetails = { subject: subject || "mailto:suporte@tchilar.ao", publicKey, privateKey };
  return {
    publicKey,
    send: (subscription, payload) => webpush.sendNotification(subscription, payload, { vapidDetails, TTL: FRESH_MINUTES * 60, urgency: "normal" })
  };
}

function buildMessage(row) {
  return {
    to: row.token,
    title: row.actor_name || "Tchilar",
    body: String(row.text || "").slice(0, 180),
    sound: "default",
    badge: row.badge,
    channelId: row.type === "message" ? "messages" : "default",
    data: { url: pushPath(row), notificationId: row.id }
  };
}

function createPush({ pool, fetchImpl = globalThis.fetch, accessToken = "", log = console, webPush = null }) {
  let running = false;
  let timer = null;

  const send = async messages => {
    let sent = 0;
    for (let index = 0; index < messages.length; index += 100) {
      const chunk = messages.slice(index, index + 100);
      let tickets = [];
      try {
        const response = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
          body: JSON.stringify(chunk)
        });
        const reply = /** @type {{ data?: any[] }} */ (await response.json().catch(() => ({})));
        tickets = reply.data || [];
        if (!response.ok) log.error?.("Push: o Expo respondeu", response.status);
      } catch (error) {
        log.error?.("Push: sem ligação ao Expo:", error.message);
        continue;
      }
      // Telemóvel desinstalou a app ou o token deixou de valer: apaga-o.
      const gone = chunk.filter((_message, position) => tickets[position]?.status === "error" && tickets[position]?.details?.error === "DeviceNotRegistered").map(message => message.to);
      if (gone.length) await pool.query("DELETE FROM push_tokens WHERE token = ANY($1)", [gone]);
      sent += tickets.filter(ticket => ticket?.status === "ok").length;
    }
    return sent;
  };

  // Browsers: um aviso por notificação (as linhas repetem-se por cada telemóvel da pessoa) e por browser.
  const sendWeb = async rows => {
    if (!webPush || !rows.length) return 0;
    const notifications = [...new Map(rows.map(row => [row.id, row])).values()];
    const subscriptions = await pool.query(`
      SELECT w.endpoint,w.p256dh,w.auth,w.user_id FROM web_push_subscriptions w
      JOIN users u ON u.id=w.user_id AND w.auth_version=u.auth_version
      WHERE w.user_id = ANY($1::int[]) AND (w.session_id IS NULL OR EXISTS(
        SELECT 1 FROM user_sessions s WHERE s.id=w.session_id AND s.revoked_at IS NULL AND s.last_seen_at > NOW() - INTERVAL '${SESSION_IDLE_DAYS} days'))`,
    [[...new Set(notifications.map(row => row.user_id))]]);
    const jobs = notifications.flatMap(row => subscriptions.rows.filter(sub => sub.user_id === row.user_id)
      .map(sub => ({ sub, payload: buildWebPayload(row) })));
    let sent = 0;
    const gone = [];
    for (let index = 0; index < jobs.length; index += 20) {
      const results = await Promise.allSettled(jobs.slice(index, index + 20).map(({ sub, payload }) =>
        webPush.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)));
      results.forEach((outcome, position) => {
        if (outcome.status === "fulfilled") { sent += 1; return; }
        // 404/410: o browser cancelou a subscrição (ou a pessoa bloqueou os avisos). Apaga-a.
        if ([404, 410].includes(outcome.reason?.statusCode)) gone.push(jobs[index + position].sub.endpoint);
        else log.error?.("Web push:", outcome.reason?.statusCode || outcome.reason?.message);
      });
    }
    if (gone.length) await pool.query("DELETE FROM web_push_subscriptions WHERE endpoint = ANY($1)", [gone]);
    return sent;
  };

  // Apanha as notificações por enviar e envia-as. Devolve quantos avisos o Expo e os browsers aceitaram.
  const processPending = async () => {
    if (running) return 0;
    running = true;
    try {
      const result = await pool.query(`
        WITH claimed AS (
          UPDATE notifications SET pushed_at=NOW()
          WHERE id IN (SELECT id FROM notifications WHERE pushed_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED)
          RETURNING id,user_id,actor_id,type,text,post_id,group_id,call_id,created_at
        )
        SELECT c.id,c.user_id,c.actor_id,c.type,c.text,c.post_id,c.group_id,c.call_id,a.display_name AS actor_name,a.username AS actor_username,t.token,
          (SELECT COUNT(*) FROM notifications n WHERE n.user_id=c.user_id AND n.read=FALSE)::int AS badge
        FROM claimed c
        JOIN users u ON u.id=c.user_id AND u.suspended_at IS NULL
        LEFT JOIN push_tokens t ON t.user_id=c.user_id AND t.auth_version=u.auth_version
        LEFT JOIN users a ON a.id=c.actor_id
        WHERE c.created_at > NOW() - INTERVAL '${FRESH_MINUTES} minutes'
        ORDER BY c.id`);
      const appMessages = result.rows.filter(row => row.token).map(buildMessage);
      const [appSent, webSent] = await Promise.all([appMessages.length ? send(appMessages) : 0, sendWeb(result.rows)]);
      return appSent + webSent;
    } finally {
      running = false;
    }
  };

  const start = (intervalMs = 3000) => {
    if (timer) return;
    timer = setInterval(() => processPending().catch(error => log.error?.("Push:", error.message)), intervalMs);
    timer.unref?.();
  };
  const stop = () => { clearInterval(timer); timer = null; };

  // Registar e retirar o token do telemóvel (a app chama ao entrar, ao abrir e ao terminar sessão).
  const registerRoutes = (app, { auth, isRecord }) => {
    app.post("/api/push-tokens", auth, async (req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!TOKEN_PATTERN.test(token)) return res.status(400).json({ error: "Token de notificações inválido." });
      if (!["ios", "android"].includes(body.platform)) return res.status(400).json({ error: "Plataforma inválida." });
      const deviceKey = typeof body.deviceKey === "string" ? body.deviceKey : "";
      if (!DEVICE_KEY_PATTERN.test(deviceKey)) return res.status(400).json({ error: "Chave do telemóvel inválida." });
      const deviceKeyHash = crypto.createHash("sha256").update(deviceKey).digest("hex");
      // O token muda de conta só quando quem o regista prova que é o mesmo telemóvel (mesma chave).
      // Assim: entrar noutra conta no mesmo telemóvel passa os avisos para a conta nova (mesmo que a saída da
      // anterior tenha sido sem internet), e quem só sabe o token de outro telemóvel não o consegue desviar.
      const result = await pool.query(`
        INSERT INTO push_tokens(token,user_id,platform,auth_version,device_key_hash)
        SELECT $1,u.id,$3,u.auth_version,$4 FROM users u WHERE u.id=$2
        ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform,
          auth_version=EXCLUDED.auth_version, device_key_hash=EXCLUDED.device_key_hash, updated_at=NOW()
        WHERE push_tokens.device_key_hash=EXCLUDED.device_key_hash
          OR (push_tokens.device_key_hash IS NULL AND push_tokens.user_id=EXCLUDED.user_id)`, [token, req.user.id, body.platform, deviceKeyHash]);
      if (!result.rowCount) return res.status(409).json({ error: "Este telemóvel já está registado noutra conta." });
      // No máximo 10 telemóveis por conta: sai o que não abre a app há mais tempo.
      await pool.query(`
        DELETE FROM push_tokens WHERE user_id=$1 AND token NOT IN (
          SELECT token FROM push_tokens WHERE user_id=$1 ORDER BY updated_at DESC LIMIT ${MAX_TOKENS_PER_USER})`, [req.user.id]);
      res.status(204).end();
    });
    app.delete("/api/push-tokens", auth, async (req, res) => {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (token) await pool.query("DELETE FROM push_tokens WHERE token=$1 AND user_id=$2", [token, req.user.id]);
      res.status(204).end();
    });

    // Site: chave pública VAPID (null = avisos no browser desligados neste servidor).
    app.get("/api/web-push/key", (_req, res) => res.json({ publicKey: webPush?.publicKey || null }));
    // O browser regista a sua subscrição. O endereço é secreto e único por browser: quem o tem é esse browser,
    // por isso entrar noutra conta no mesmo browser passa os avisos para a conta nova.
    app.post("/api/web-push/subscriptions", auth, async (req, res) => {
      if (!webPush) return res.status(503).json({ error: "Os avisos no browser ainda não estão ligados neste servidor." });
      const subscription = parseWebSubscription(isRecord(req.body) ? req.body : {});
      if (!subscription) return res.status(400).json({ error: "Subscrição de avisos inválida." });
      await pool.query(`
        INSERT INTO web_push_subscriptions(endpoint,user_id,session_id,p256dh,auth,auth_version)
        SELECT $1,u.id,$3,$4,$5,u.auth_version FROM users u WHERE u.id=$2
        ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, session_id=EXCLUDED.session_id, p256dh=EXCLUDED.p256dh,
          auth=EXCLUDED.auth, auth_version=EXCLUDED.auth_version, updated_at=NOW()`,
      [subscription.endpoint, req.user.id, typeof req.user.sid === "string" ? req.user.sid : null, subscription.p256dh, subscription.auth]);
      await pool.query(`
        DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint NOT IN (
          SELECT endpoint FROM web_push_subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT ${MAX_BROWSERS_PER_USER})`, [req.user.id]);
      res.status(204).end();
    });
    app.delete("/api/web-push/subscriptions", auth, async (req, res) => {
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
      if (endpoint) await pool.query("DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND user_id=$2", [endpoint, req.user.id]);
      res.status(204).end();
    });
  };

  return { processPending, registerRoutes, start, stop };
}

module.exports = { EXPO_PUSH_URL, TOKEN_PATTERN, buildMessage, buildWebPayload, createPush, createWebPushSender, parseWebSubscription, pushPath, sitePath };
