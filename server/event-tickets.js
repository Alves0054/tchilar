// Bilhetes de eventos, pagos com dinheiro pelos meios do Tchilar (Express, Referência, PayPay, PayPal...).
// - Quem organiza fica com 85% de cada venda e o Tchilar com 15% (EVENT_TICKET_ORGANIZER_SHARE).
// - O dinheiro de um bilhete só pode ser levantado 1 dia depois de o evento começar (available_at): até lá pode
//   ser devolvido se o evento for cancelado (gatilho na base de dados, migrações 071 e 072).
// - Cada bilhete pago tem um código curto. O QR leva uma ligação para o evento com esse código: quem organiza
//   aponta a câmara do telemóvel, abre o Tchilar e o bilhete fica validado (ou escreve o código à mão).
// - Os pagamentos, recibos e reembolsos seguem o mesmo caminho dos cursos (purpose "event_ticket").
const crypto = require("crypto");
const QRCode = require("qrcode");
const { METHODS, issuer, receiptNumber } = require("./payment-records");
const { buildTicketEmail } = require("./ticket-email");

const EVENT_TICKET_ORGANIZER_SHARE = 0.85;
const MIN_TICKET_KZ = 100;
const MAX_TICKET_KZ = 1_000_000;
const MAX_TICKETS = 100_000;
const PENDING_HOLD_MINUTES = 30;            // um pagamento a meio guarda o lugar durante 30 min (para não esgotar a mais)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0 e I/1, que se confundem à porta

const ticketShareKz = gross => Math.round(Number(gross || 0) * EVENT_TICKET_ORGANIZER_SHARE * 100) / 100;

function ticketCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
const normalizeCode = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

// Preço (Kz) e lotação vindos do formulário de criar evento. Sem preço, o evento é grátis (botão "Vou").
function parseTicketInput(body) {
  const rawPrice = body.ticketPriceKz ?? body.ticket_price_kz;
  const rawTotal = body.ticketsTotal ?? body.tickets_total;
  const price = rawPrice === undefined || rawPrice === null || rawPrice === "" ? 0 : Number(rawPrice);
  const total = rawTotal === undefined || rawTotal === null || rawTotal === "" ? null : Number(rawTotal);
  if (!Number.isFinite(price) || price < 0 || (price > 0 && (price < MIN_TICKET_KZ || price > MAX_TICKET_KZ)) || Math.round(price * 100) !== price * 100) {
    return { error: `O bilhete custa entre ${MIN_TICKET_KZ} e ${MAX_TICKET_KZ.toLocaleString("pt-PT")} Kz.` };
  }
  if (total !== null && (!Number.isInteger(total) || total < 1 || total > MAX_TICKETS)) return { error: "Indica quantos bilhetes há (pelo menos 1)." };
  return { price, total: price ? total : null };
}

const checkInUrl = (appUrl, eventId, code) => `${appUrl.replace(/\/$/, "")}/events/${eventId}?checkin=${encodeURIComponent(code)}`;

// Bilhete válido: pago e sem reembolso.
const VALID_TICKET = "t.status='paid' AND t.refund_status IS NULL";

// Um evento pago com bilhetes vendidos só pode ser apagado (e devolvido) antes de começar.
async function deleteBlockedReason(client, eventId) {
  const row = (await client.query(`
    SELECT e.starts_at <= NOW() AS started, (SELECT COUNT(*) FROM event_tickets t WHERE t.event_id=e.id AND ${VALID_TICKET})::int AS sold
    FROM events e WHERE e.id=$1`, [eventId])).rows[0];
  return row?.started && row.sold > 0 ? "Este evento já começou e tem bilhetes vendidos: já não pode ser apagado." : null;
}

function registerEventTickets(app, deps) {
  const { pool, auth, parseId, isRecord, transaction, blockedBetween, appUrl, payments, secret, apiUrl = appUrl, emailQueue = null } = deps;

  // O QR do email é uma imagem pública (os programas de email não enviam sessão), mas só abre com uma
  // assinatura daquele bilhete: não se consegue adivinhar o QR de outra pessoa.
  const qrSignature = ticketId => crypto.createHmac("sha256", secret).update(`ticket-qr:${ticketId}`).digest("base64url").slice(0, 32);
  const qrImageUrl = ticketId => `${apiUrl.replace(/\/$/, "")}/api/tickets/${ticketId}/qr.png?s=${qrSignature(ticketId)}`;

  // Email do bilhete (desenho em design/emails/bilhete.html), posto na fila dentro da mesma transação.
  async function queueTicketEmail(client, ticketId, method) {
    if (!emailQueue) return;
    const row = (await client.query(`
      SELECT t.id,t.code,t.amount_kz::float AS amount_kz,t.paid_at,e.id AS event_id,e.name,e.starts_at,e.location,
        COALESCE(p.name, o.display_name, 'Tchilar') AS organizer,b.display_name AS buyer_name,b.email
      FROM event_tickets t JOIN events e ON e.id=t.event_id JOIN users b ON b.id=t.user_id
      LEFT JOIN pages p ON p.id=e.page_id LEFT JOIN users o ON o.id=e.creator_id
      WHERE t.id=$1`, [ticketId])).rows[0];
    if (!row?.email) return;
    const mail = buildTicketEmail({
      eventName: row.name, startsAt: row.starts_at, location: row.location, organizer: row.organizer, buyerName: row.buyer_name,
      code: row.code, amountKz: row.amount_kz, method: METHODS[method] || METHODS.demo, receipt: receiptNumber("event_ticket", row.id, row.paid_at),
      ticketUrl: `${appUrl.replace(/\/$/, "")}/events/${row.event_id}`, qrUrl: qrImageUrl(row.id),
      logoUrl: `${appUrl.replace(/\/$/, "")}/tchilar-logo-full.png`, company: issuer()
    });
    await emailQueue.enqueue({ to: row.email, subject: mail.subject, text: mail.text, html: mail.html, kind: "receipt" }, client);
  }

  app.get("/api/tickets/:ticketId/qr.png", async (req, res) => {
    const ticketId = parseId(req.params.ticketId);
    const given = String(req.query.s || "");
    if (!ticketId || given.length !== 32 || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(qrSignature(ticketId)))) {
      return res.status(404).end();
    }
    const ticket = (await pool.query(`SELECT t.event_id,t.code FROM event_tickets t WHERE t.id=$1 AND ${VALID_TICKET} AND t.event_id IS NOT NULL`, [ticketId])).rows[0];
    if (!ticket) return res.status(404).end();
    const png = await QRCode.toBuffer(checkInUrl(appUrl, ticket.event_id, ticket.code), { width: 480, margin: 2, errorCorrectionLevel: "M" });
    res.set("Cache-Control", "private, max-age=86400");
    res.type("png").send(png);
  });

  // Quem organiza: quem criou o evento ou quem gere a página do evento.
  const organizerSql = "(e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2))";

  // Comprar: cria (ou reaproveita) a compra pendente e abre o pagamento escolhido.
  app.post("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const body = isRecord(req.body) ? req.body : {};
    const prepared = await transaction(async client => {
      const event = (await client.query(`
        SELECT e.id,e.name,e.creator_id,e.ticket_price_kz::float AS price,e.tickets_total,e.starts_at,
          (SELECT COUNT(*) FROM event_tickets t WHERE t.event_id=e.id AND t.user_id<>$2
            AND (${VALID_TICKET} OR (t.status='pending' AND t.created_at > NOW() - make_interval(mins => ${PENDING_HOLD_MINUTES}))))::int AS taken
        FROM events e
        WHERE e.id=$1 AND NOT ${blockedBetween("$2", "e.creator_id")}
          AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))
        FOR UPDATE OF e`, [eventId, req.user.id])).rows[0];
      if (!event) return { status: 404, error: "Evento não encontrado." };
      if (!event.price) return { status: 409, error: "Este evento é grátis: carrega em «Vou»." };
      if (event.creator_id === req.user.id) return { status: 400, error: "Não precisas de bilhete para o teu próprio evento." };
      if (new Date(event.starts_at).getTime() <= Date.now()) return { status: 409, error: "Este evento já começou: já não se vendem bilhetes." };
      const mine = (await client.query("SELECT id,status,refund_status FROM event_tickets WHERE event_id=$1 AND user_id=$2", [eventId, req.user.id])).rows[0];
      if (mine?.status === "paid" && !mine.refund_status) return { status: 409, error: "Já tens bilhete para este evento." };
      if (event.tickets_total && event.taken >= event.tickets_total) return { status: 409, error: "Os bilhetes esgotaram." };
      const available = new Date(new Date(event.starts_at).getTime() + 24 * 60 * 60 * 1000);
      // A compra anterior (à espera de pagamento ou reembolsada) fica no registo, desligada do evento. Nunca se apaga:
      // pode haver um pagamento a caminho (ex.: Referência). Se ele chegar, o dinheiro é devolvido (ver a confirmação).
      if (mine) await client.query("UPDATE event_tickets SET event_id=NULL WHERE id=$1", [mine.id]);
      const ticket = (await client.query(`
        INSERT INTO event_tickets(event_id,user_id,owner_id,event_name,amount_kz,status,stars,available_at)
        VALUES($1,$2,$3,$4,$5,'pending',0,$6) RETURNING id::int AS id`,
      [eventId, req.user.id, event.creator_id, event.name, event.price, available])).rows[0];
      return { ticketId: ticket.id, event };
    });
    if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });
    const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
    const result = await payments.start({
      purpose: "event_ticket", refId: prepared.ticketId, amountKz: prepared.event.price, userId: req.user.id, email: user.rows[0]?.email,
      method: body.method, phone: body.phone, promoCode: body.promoCode, name: `Bilhete «${prepared.event.name}»`,
      successPath: `/events/${eventId}?pagamento=sucesso`, cancelPath: `/events/${eventId}?pagamento=cancelado`,
      onSession: sessionId => pool.query("UPDATE event_tickets SET stripe_session_id=$2 WHERE id=$1", [prepared.ticketId, sessionId])
    });
    if (result.error) return res.status(503).json({ error: result.error });
    res.status(201).json(result);
  });

  // Pagamento confirmado: o bilhete ganha o código e a pessoa passa a ir ao evento.
  // Se o pagamento chegar tarde (ex.: Referência paga dias depois) e o evento já não existir, a compra tiver sido
  // substituída por outra, ou a lotação já estiver cheia, o dinheiro fica por devolver (Administração → Pagamentos)
  // e não conta para quem organiza.
  payments.register("event_ticket", async (ticketId, details) => {
    const method = details.method || (details.paymentIntent ? "card" : "demo");
    const issued = await transaction(async client => {
      const ticket = (await client.query("SELECT id,event_id,user_id,owner_id,event_name FROM event_tickets WHERE id=$1 AND status='pending' FOR UPDATE",
        [ticketId])).rows[0];
      if (!ticket) return; // já confirmado (confirmação repetida) ou desconhecido
      const event = ticket.event_id ? (await client.query(`
        SELECT e.tickets_total,
          (SELECT COUNT(*) FROM event_tickets t WHERE t.event_id=e.id AND t.id<>$2 AND ${VALID_TICKET})::int AS sold
        FROM events e WHERE e.id=$1 FOR UPDATE OF e`, [ticket.event_id, ticketId])).rows[0] : null;
      const full = event?.tickets_total && event.sold >= event.tickets_total;
      if (!event || full) {
        await client.query("UPDATE event_tickets SET status='paid', paid_at=NOW(), stripe_payment_intent=$2, refund_status='manual' WHERE id=$1",
          [ticketId, details.paymentIntent || null]);
        // Fica por devolver: não há bilhete, por isso não há email de bilhete.
        await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'event_refund',$2)", [ticket.user_id, full
          ? `Os bilhetes para «${ticket.event_name}» esgotaram antes de o teu pagamento chegar. Vamos devolver-te o dinheiro.`
          : `O teu pagamento para «${ticket.event_name}» já não corresponde a um bilhete (o evento foi cancelado ou fizeste outra compra). Vamos devolver-te o dinheiro.`]);
        return;
      }
      let code = null;
      for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
        const result = await client.query(`
          UPDATE event_tickets SET status='paid', paid_at=NOW(), code=$3, stripe_payment_intent=$2
          WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM event_tickets x WHERE x.code=$3) RETURNING code`,
        [ticketId, details.paymentIntent || null, ticketCode()]);
        code = result.rows[0]?.code || null;
      }
      if (!code) throw new Error("Não foi possível gerar o código do bilhete.");
      await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [ticket.event_id, ticket.user_id]);
      await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'payment',$2)",
        [ticket.user_id, `O teu bilhete para «${ticket.event_name}» está pronto. Mostra o QR à entrada.`]);
      if (ticket.owner_id && ticket.owner_id !== ticket.user_id) {
        await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'event_ticket',$3)",
          [ticket.owner_id, ticket.user_id, `Comprou um bilhete para «${ticket.event_name}». Os teus 85% ficam disponíveis 1 dia depois do evento.`]);
      }
      await queueTicketEmail(client, ticketId, method);
      return true;
    });
    if (issued) emailQueue?.kick();
  });

  // O QR do próprio bilhete (PNG). Leva a ligação de validação, nunca dados pessoais.
  app.get("/api/events/:eventId/tickets/mine/qr", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const ticket = (await pool.query(`SELECT t.code FROM event_tickets t WHERE t.event_id=$1 AND t.user_id=$2 AND ${VALID_TICKET}`, [eventId, req.user.id])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Não tens bilhete para este evento." });
    const png = await QRCode.toBuffer(checkInUrl(appUrl, eventId, ticket.code), { width: 480, margin: 2, errorCorrectionLevel: "M" });
    res.set("Cache-Control", "private, no-store");
    res.type("png").send(png);
  });

  // Lista de bilhetes vendidos (só quem organiza). Nunca leva o código: quem vê este ecrã à porta não pode
  // copiar um código e entrar com ele (o código só é mostrado a quem comprou, no bilhete e no email).
  app.get("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const event = await pool.query(`SELECT e.id,e.tickets_total FROM events e WHERE e.id=$1 AND ${organizerSql}`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(403).json({ error: "Só quem organiza vê os bilhetes." });
    const tickets = await pool.query(`
      SELECT t.id::int AS id,t.amount_kz::float AS amount_kz,t.paid_at AS created_at,t.checked_in_at,u.username,u.display_name,u.avatar_url
      FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event_id=$1 AND ${VALID_TICKET} ORDER BY t.paid_at DESC LIMIT 1000`, [eventId]);
    const rows = tickets.rows;
    const gross = rows.reduce((sum, row) => sum + row.amount_kz, 0);
    res.json({
      tickets: rows,
      sold: rows.length,
      checked_in: rows.filter(row => row.checked_in_at).length,
      gross_kz: Math.round(gross * 100) / 100,
      net_kz: ticketShareKz(gross),
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
      FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event_id=$1 AND t.code=$2 AND ${VALID_TICKET}`, [eventId, code])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Bilhete inválido para este evento." });
    const person = { username: ticket.username, display_name: ticket.display_name, avatar_url: ticket.avatar_url };
    if (ticket.checked_in_at) return res.status(409).json({ error: "Este bilhete já entrou.", checked_in_at: ticket.checked_in_at, person });
    await pool.query("UPDATE event_tickets SET checked_in_at=NOW(),checked_in_by=$2 WHERE id=$1 AND checked_in_at IS NULL", [ticket.id, req.user.id]);
    res.json({ ok: true, person });
  });
}

module.exports = {
  EVENT_TICKET_ORGANIZER_SHARE, MIN_TICKET_KZ, VALID_TICKET, checkInUrl, deleteBlockedReason, normalizeCode, parseTicketInput,
  registerEventTickets, ticketCode, ticketShareKz
};
