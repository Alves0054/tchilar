// Bilhetes de eventos pagos em estrelas.
// - Quem compra gasta estrelas; quem organiza recebe-as como presente (contam para os levantamentos,
//   com a mesma parte do Tchilar que os presentes dos diretos).
// - Cada bilhete tem um código curto. O QR leva uma ligação para o evento com esse código: quem organiza
//   aponta a câmara do telemóvel, abre o Tchilar e o bilhete fica validado (ou escreve o código à mão).
// - Se o evento for apagado antes de começar, as estrelas voltam a quem comprou.
const crypto = require("crypto");
const QRCode = require("qrcode");

const MAX_TICKET_STARS = 100_000;
const MAX_TICKETS = 100_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0 e I/1, que se confundem à porta
const balanceSql = "SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS balance FROM star_ledger WHERE user_id=$1";

function ticketCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
const normalizeCode = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

// Preço e lotação vindos do formulário de criar evento. Sem preço, o evento é grátis (botão "Vou").
function parseTicketInput(body) {
  const rawPrice = body.ticketStars ?? body.ticket_stars;
  const rawTotal = body.ticketsTotal ?? body.tickets_total;
  const price = rawPrice === undefined || rawPrice === null || rawPrice === "" ? 0 : Number(rawPrice);
  const total = rawTotal === undefined || rawTotal === null || rawTotal === "" ? null : Number(rawTotal);
  if (!Number.isInteger(price) || price < 0 || price > MAX_TICKET_STARS) return { error: `O bilhete custa entre 0 e ${MAX_TICKET_STARS.toLocaleString("pt-PT")} estrelas.` };
  if (total !== null && (!Number.isInteger(total) || total < 1 || total > MAX_TICKETS)) return { error: "Indica quantos bilhetes há (pelo menos 1)." };
  return { price, total: price ? total : null };
}

const checkInUrl = (appUrl, eventId, code) => `${appUrl.replace(/\/$/, "")}/events/${eventId}?checkin=${encodeURIComponent(code)}`;

// Devolve as estrelas de todos os bilhetes de um evento (antes de o apagar). Corre dentro de uma transação.
async function refundEventTickets(client, eventId) {
  const tickets = (await client.query(`
    SELECT t.user_id,t.stars,e.name FROM event_tickets t JOIN events e ON e.id=t.event_id
    WHERE t.event_id=$1 AND t.stars > 0`, [eventId])).rows;
  for (const ticket of tickets) {
    await client.query("INSERT INTO star_ledger(user_id,amount,kind,event_id) VALUES($1,$2,'refund',$3)", [ticket.user_id, ticket.stars, eventId]);
    await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'event_refund',$2)",
      [ticket.user_id, `O evento «${ticket.name}» foi cancelado. Devolvemos-te ${ticket.stars} estrelas do bilhete.`]);
  }
  await client.query("DELETE FROM star_ledger WHERE event_id=$1 AND kind='gift_received'", [eventId]);
  return tickets.length;
}

function registerEventTickets(app, deps) {
  const { pool, auth, parseId, transaction, blockedBetween, appUrl } = deps;

  // Quem organiza: quem criou o evento ou quem gere a página do evento.
  const organizerSql = "(e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2))";

  app.post("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const outcome = await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(42, $1)", [req.user.id]);
      const event = (await client.query(`
        SELECT e.id,e.name,e.creator_id,e.ticket_stars,e.tickets_total,e.starts_at,
          (SELECT COUNT(*) FROM event_tickets t WHERE t.event_id=e.id)::int AS sold
        FROM events e
        WHERE e.id=$1 AND NOT ${blockedBetween("$2", "e.creator_id")}
          AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))
        FOR UPDATE OF e`, [eventId, req.user.id])).rows[0];
      if (!event) return { status: 404, error: "Evento não encontrado." };
      if (!event.ticket_stars) return { status: 409, error: "Este evento é grátis: carrega em «Vou»." };
      if (event.creator_id === req.user.id) return { status: 400, error: "Não precisas de bilhete para o teu próprio evento." };
      if (new Date(event.starts_at).getTime() < Date.now() - 6 * 60 * 60 * 1000) return { status: 409, error: "Este evento já terminou." };
      const existing = (await client.query("SELECT code FROM event_tickets WHERE event_id=$1 AND user_id=$2", [eventId, req.user.id])).rows[0];
      if (existing) return { status: 409, error: "Já tens bilhete para este evento." };
      if (event.tickets_total && event.sold >= event.tickets_total) return { status: 409, error: "Os bilhetes esgotaram." };
      const balance = (await client.query(balanceSql, [req.user.id])).rows[0].balance;
      if (balance < event.ticket_stars) return { status: 402, error: "Não tens estrelas suficientes.", balance, price: event.ticket_stars };
      await client.query(`
        INSERT INTO star_ledger(user_id,amount,kind,counterpart_id,event_id)
        VALUES($1,$2,'gift_sent',$3,$4),($3,$5,'gift_received',$1,$4)`,
      [req.user.id, -event.ticket_stars, event.creator_id, eventId, event.ticket_stars]);
      let code;
      for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
        const candidate = ticketCode();
        const inserted = await client.query(`
          INSERT INTO event_tickets(event_id,user_id,code,stars) VALUES($1,$2,$3,$4)
          ON CONFLICT (code) DO NOTHING RETURNING code`, [eventId, req.user.id, candidate, event.ticket_stars]);
        code = inserted.rows[0]?.code;
      }
      if (!code) throw new Error("Não foi possível gerar o código do bilhete.");
      await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [eventId, req.user.id]);
      await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'event_ticket',$3)",
        [event.creator_id, req.user.id, `Comprou um bilhete para «${event.name}» (${event.ticket_stars} estrelas).`]);
      return { ticket: { code, stars: event.ticket_stars, checked_in_at: null }, balance: balance - event.ticket_stars };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error, balance: outcome.balance, price: outcome.price });
    res.status(201).json(outcome);
  });

  // O QR do próprio bilhete (PNG). Leva a ligação de validação, nunca dados pessoais.
  app.get("/api/events/:eventId/tickets/mine/qr", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const ticket = (await pool.query("SELECT code FROM event_tickets WHERE event_id=$1 AND user_id=$2", [eventId, req.user.id])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Não tens bilhete para este evento." });
    const png = await QRCode.toBuffer(checkInUrl(appUrl, eventId, ticket.code), { width: 480, margin: 2, errorCorrectionLevel: "M" });
    res.set("Cache-Control", "private, no-store");
    res.type("png").send(png);
  });

  // Lista de bilhetes vendidos (só quem organiza).
  app.get("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const event = await pool.query(`SELECT e.id,e.ticket_stars,e.tickets_total FROM events e WHERE e.id=$1 AND ${organizerSql}`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(403).json({ error: "Só quem organiza vê os bilhetes." });
    const tickets = await pool.query(`
      SELECT t.code,t.stars,t.created_at,t.checked_in_at,u.username,u.display_name,u.avatar_url
      FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event_id=$1 ORDER BY t.created_at DESC LIMIT 1000`, [eventId]);
    const rows = tickets.rows;
    res.json({
      tickets: rows,
      sold: rows.length,
      checked_in: rows.filter(row => row.checked_in_at).length,
      stars: rows.reduce((sum, row) => sum + row.stars, 0),
      total: event.rows[0].tickets_total
    });
  });

  // Validar um bilhete à entrada (código escrito ou lido do QR). Cada bilhete só entra uma vez.
  app.post("/api/events/:eventId/check-in", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    const code = normalizeCode(req.body?.code);
    if (!eventId || code.length < 6) return res.status(400).json({ error: "Indica o código do bilhete." });
    const event = await pool.query(`SELECT e.id FROM events e WHERE e.id=$1 AND ${organizerSql}`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(403).json({ error: "Só quem organiza pode validar bilhetes." });
    const ticket = (await pool.query(`
      SELECT t.id,t.checked_in_at,u.username,u.display_name,u.avatar_url
      FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event_id=$1 AND t.code=$2`, [eventId, code])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Bilhete inválido para este evento." });
    const person = { username: ticket.username, display_name: ticket.display_name, avatar_url: ticket.avatar_url };
    if (ticket.checked_in_at) return res.status(409).json({ error: "Este bilhete já entrou.", checked_in_at: ticket.checked_in_at, person });
    await pool.query("UPDATE event_tickets SET checked_in_at=NOW(),checked_in_by=$2 WHERE id=$1 AND checked_in_at IS NULL", [ticket.id, req.user.id]);
    res.json({ ok: true, person });
  });
}

module.exports = { MAX_TICKET_STARS, checkInUrl, normalizeCode, parseTicketInput, refundEventTickets, registerEventTickets, ticketCode };
