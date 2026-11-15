// Notificações push para a app (iOS e Android) através do serviço de push do Expo.
// O Expo entrega ao APNs (Apple) e ao FCM (Google); no servidor só é preciso o token de cada telemóvel.
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

function createPush({ pool, fetchImpl = globalThis.fetch, accessToken = "", log = console }) {
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

  // Apanha as notificações por enviar e envia-as. Devolve quantos avisos o Expo aceitou.
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
        JOIN push_tokens t ON t.user_id=c.user_id AND t.auth_version=u.auth_version
        LEFT JOIN users a ON a.id=c.actor_id
        WHERE c.created_at > NOW() - INTERVAL '${FRESH_MINUTES} minutes'
        ORDER BY c.id`);
      return result.rows.length ? await send(result.rows.map(buildMessage)) : 0;
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
  };

  return { processPending, registerRoutes, start, stop };
}

module.exports = { EXPO_PUSH_URL, TOKEN_PATTERN, buildMessage, createPush, pushPath };
