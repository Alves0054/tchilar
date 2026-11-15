// Sessões por aparelho. Cada início de sessão cria uma linha em user_sessions e o token leva o id (sid).
// Uma sessão sem prazo só deixa de valer quando é terminada (revoked_at), quando a palavra-passe muda,
// quando se terminam as outras sessões (auth_version) ou quando a conta é suspensa.
const crypto = require("node:crypto");

// Nome do aparelho: a app manda "X-Tchilar-Device" (ex.: "iPhone 15 · iOS 18"); o site deduz do browser.
function deviceLabel(req) {
  const fromApp = typeof req.headers["x-tchilar-device"] === "string" ? req.headers["x-tchilar-device"].replace(/[^\p{L}\p{N} .,·()_/-]/gu, "").trim() : "";
  if (fromApp) return fromApp.slice(0, 80);
  const ua = String(req.headers["user-agent"] || "");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const system = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ");
}

async function createSession(db, userId, { client = "web", device = "" } = {}) {
  const id = crypto.randomUUID();
  await db.query("INSERT INTO user_sessions(id,user_id,client,device) VALUES($1,$2,$3,$4)", [id, userId, client === "app" ? "app" : "web", device.slice(0, 120)]);
  return id;
}

// "Visto agora" de cada sessão, no máximo de 5 em 5 minutos (em memória, por cópia da API).
const lastTouch = new Map();
function touchSession(pool, sid) {
  if (!sid) return;
  const now = Date.now();
  if (now - (lastTouch.get(sid) || 0) < 5 * 60 * 1000) return;
  lastTouch.set(sid, now);
  if (lastTouch.size > 100000) lastTouch.clear();
  pool.query("UPDATE user_sessions SET last_seen_at=NOW() WHERE id=$1", [sid]).catch(() => lastTouch.delete(sid));
}

// Um token é válido se a conta existe, a versão bate certo e a sessão do token não foi terminada.
// Tokens sem sessão (sid) só valem se ainda tiverem prazo (os antigos, de 12 horas).
function validSession(row, claims) {
  if (!row || Number(row.auth_version) !== Number(claims.version || 0)) return false;
  return claims.sid ? row.session_ok === true : Boolean(claims.exp);
}

function registerSessionRoutes(app, { pool, auth, parseId }) {
  app.get("/api/auth/sessions", auth, async (req, res) => {
    const result = await pool.query(`
      SELECT id,client,device,created_at,last_seen_at FROM user_sessions
      WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 50`, [req.user.id]);
    res.json({ sessions: result.rows.map(row => ({ ...row, current: row.id === req.user.sid })) });
  });
  // Terminar um aparelho (pode ser este: é o mesmo que sair).
  app.delete("/api/auth/sessions/:id", auth, async (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: "Sessão inválida." });
    const result = await pool.query("UPDATE user_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Sessão não encontrada." });
    res.json({ ended: true, current: id === req.user.sid });
  });
  // Sair: termina a sessão deste aparelho no servidor (o token deixa de valer, mesmo que alguém o tenha copiado).
  app.post("/api/auth/logout", auth, async (req, res) => {
    if (req.user.sid) await pool.query("UPDATE user_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2", [req.user.sid, req.user.id]);
    res.json({ ended: true });
  });
  void parseId;
}

module.exports = { createSession, deviceLabel, registerSessionRoutes, touchSession, validSession };
