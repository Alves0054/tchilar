// Mensagens e notificações.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { blockedBetween } = require("./moderation");

function registerMessageRoutes(app, deps) {
  const {
    BLOCKED_ERROR, auth, cleanText, isBlocked, isRecord, parseId, pool, reachAllowed, transaction
  } = deps;

  app.get("/api/notifications", auth, async (req, res) => {
    const [notifications, unread] = await Promise.all([
      pool.query(`
        SELECT n.id,n.type,n.text,n.read,n.created_at,n.actor_id,n.post_id,n.group_id,n.call_id,n.event_id,
          u.username AS actor_username,u.display_name AS actor_name,u.avatar_url AS actor_avatar
        FROM notifications n LEFT JOIN users u ON u.id=n.actor_id
        WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]),
      pool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read=FALSE", [req.user.id])
    ]);
    res.json({ notifications: notifications.rows, unreadCount: unread.rows[0].count });
  });

  app.post("/api/notifications/:id/read", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Notificação inválida." });
    const result = await pool.query(
      "UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Notificação não encontrada." });
    res.json({ read: true });
  });

  app.post("/api/notifications/read-all", auth, async (req, res) => {
    await pool.query("UPDATE notifications SET read=TRUE WHERE user_id=$1 AND read=FALSE", [req.user.id]);
    res.json({ read: true });
  });

  app.get("/api/messages/unread-count", auth, async (req, res) => {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id=$1 AND read_at IS NULL", [req.user.id]);
    res.json({ unread: result.rows[0].count });
  });

  app.get("/api/messages/:userId", auth, async (req, res) => {
    const other = parseId(req.params.userId);
    if (!other || other === req.user.id) return res.status(400).json({ error: "Destinatário inválido." });
    // ?after=<id>: só mensagens mais recentes (usado para atualizar a conversa ao vivo).
    const after = req.query.after === undefined ? null : parseId(req.query.after);
    if (req.query.after !== undefined && !after) return res.status(400).json({ error: "Parâmetro inválido." });
    const recipient = await pool.query(
      `SELECT id,username,display_name,avatar_url,${blockedBetween("$2", "users.id")} AS blocked FROM users WHERE id=$1`,
      [other, req.user.id]);
    if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
    const r = await pool.query(`
      SELECT * FROM (
        SELECT m.id,m.sender_id,m.receiver_id,m.body,m.created_at,m.read_at, s.username AS sender_username
        FROM messages m JOIN users s ON s.id=m.sender_id
        WHERE ((m.sender_id=$1 AND m.receiver_id=$2) OR (m.sender_id=$2 AND m.receiver_id=$1))
          AND ($3::int IS NULL OR m.id > $3)
        ORDER BY m.created_at DESC, m.id DESC LIMIT 100
      ) recent ORDER BY created_at ASC, id ASC`, [req.user.id, other, after]);
    await pool.query(
      "UPDATE messages SET read_at=NOW() WHERE sender_id=$1 AND receiver_id=$2 AND read_at IS NULL",
      [other, req.user.id]);
    const { blocked, ...person } = recipient.rows[0];
    res.json({ messages: r.rows, person, canMessage: !blocked });
  });

  app.get("/api/messages", auth, async (req, res) => {
    const r = await pool.query(`
      SELECT other.id,other.username,other.display_name,other.avatar_url,
        latest.body AS latest_message,latest.created_at AS latest_message_at,
        (SELECT COUNT(*)::int FROM messages um WHERE um.sender_id=other.id AND um.receiver_id=$1 AND um.read_at IS NULL) AS unread
      FROM (
        SELECT DISTINCT ON (CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END)
          CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END AS other_id,
          body,created_at
        FROM messages
        WHERE sender_id=$1 OR receiver_id=$1
        ORDER BY CASE WHEN sender_id=$1 THEN receiver_id ELSE sender_id END,created_at DESC
      ) latest
      JOIN users other ON other.id=latest.other_id
      WHERE NOT ${blockedBetween("$1", "other.id")}
      ORDER BY latest.created_at DESC`, [req.user.id]);
    res.json({ conversations: r.rows });
  });

  app.post("/api/messages/:userId", auth, async (req, res) => {
    const other = parseId(req.params.userId);
    const bodyData = isRecord(req.body) ? req.body : {};
    const body = cleanText(bodyData.body);
    if (!other || other === req.user.id) {
      return res.status(400).json({ error: "Destinatário inválido." });
    }
    if (!body || typeof bodyData.body !== "string") return res.status(400).json({ error: "Mensagem vazia." });
    if (bodyData.body.length > 4000) return res.status(400).json({ error: "A mensagem excede 4000 caracteres." });
    const recipient = await pool.query("SELECT 1 FROM users WHERE id=$1 AND suspended_at IS NULL", [other]);
    if (!recipient.rowCount) return res.status(404).json({ error: "Destinatário não encontrado." });
    if (await isBlocked(req.user.id, other)) return res.status(403).json({ error: BLOCKED_ERROR });
    if (!(await reachAllowed("messages", other, req.user.id))) {
      return res.status(403).json({ error: "Esta conta escolheu quem lhe pode enviar mensagens, e de momento não podes escrever-lhe." });
    }
    const message = await transaction(async client => {
      const result = await client.query(
        "INSERT INTO messages(sender_id,receiver_id,body) VALUES($1,$2,$3) RETURNING *",
        [req.user.id, other, body]);
      await client.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'message','Enviou-te uma mensagem.')`, [other, req.user.id]);
      return result.rows[0];
    });
    res.status(201).json({ message });
  });
}

module.exports = { registerMessageRoutes };
