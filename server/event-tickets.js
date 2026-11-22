// Bilhetes de eventos, pagos com dinheiro pelos meios do Tchilar (Express, Referência, PayPay, PayPal...).
// - Quem organiza fica com 85% de cada venda e o Tchilar com 15% (EVENT_TICKET_ORGANIZER_SHARE).
// - O dinheiro de um bilhete só pode ser levantado 1 dia depois de o evento começar (available_at): até lá pode
//   ser devolvido se o evento for cancelado (gatilho na base de dados, migrações 071 e 072).
// - Cada compra tem 1 a 10 entradas; cada entrada tem um código curto e o seu QR (cada pessoa entra com o seu).
//   O QR leva uma ligação para o evento com esse código: quem organiza lê-o no Modo entrada da app ou com a
//   câmara do telemóvel (abre o Tchilar e valida), ou escreve o código à mão.
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

// Compra válida: paga e sem reembolso. Cada compra tem "quantity" entradas, cada uma com o seu código.
const VALID_TICKET = "t.status='paid' AND t.refund_status IS NULL";
const MAX_PER_ORDER = 10;

// Quantidade pedida numa compra (1 a 10; vazio = 1).
function parseQuantity(value) {
  const quantity = value === undefined || value === null || value === "" ? 1 : Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_PER_ORDER ? quantity : null;
}

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
  // assinatura daquela entrada: não se consegue adivinhar o QR de outra pessoa.
  const qrSignature = codeId => crypto.createHmac("sha256", secret).update(`ticket-code-qr:${codeId}`).digest("base64url").slice(0, 32);
  const qrImageUrl = codeId => `${apiUrl.replace(/\/$/, "")}/api/tickets/codes/${codeId}/qr.png?s=${qrSignature(codeId)}`;
  const qrPng = (eventId, code) => QRCode.toBuffer(checkInUrl(appUrl, eventId, code), { width: 480, margin: 2, errorCorrectionLevel: "M" });

  // Email dos bilhetes (desenho em design/emails/bilhete.html), posto na fila dentro da mesma transação.
  async function queueTicketEmail(client, ticketId, method) {
    if (!emailQueue) return;
    const row = (await client.query(`
      SELECT t.id,t.quantity,t.amount_kz::float AS amount_kz,t.paid_at,e.id AS event_id,e.name,e.starts_at,e.location,
        COALESCE(p.name, o.display_name, 'Tchilar') AS organizer,b.display_name AS buyer_name,b.email
      FROM event_tickets t JOIN events e ON e.id=t.event_id JOIN users b ON b.id=t.user_id
      LEFT JOIN pages p ON p.id=e.page_id LEFT JOIN users o ON o.id=e.creator_id
      WHERE t.id=$1`, [ticketId])).rows[0];
    if (!row?.email) return;
    const codes = (await client.query("SELECT id::int AS id,code FROM event_ticket_codes WHERE ticket_id=$1 ORDER BY id", [ticketId])).rows;
    const mail = buildTicketEmail({
      eventName: row.name, startsAt: row.starts_at, location: row.location, organizer: row.organizer, buyerName: row.buyer_name,
      tickets: codes.map(item => ({ code: item.code, qrUrl: qrImageUrl(item.id) })),
      amountKz: row.amount_kz, method: METHODS[method] || METHODS.demo, receipt: receiptNumber("event_ticket", row.id, row.paid_at),
      ticketUrl: `${appUrl.replace(/\/$/, "")}/events/${row.event_id}`,
      logoUrl: `${appUrl.replace(/\/$/, "")}/tchilar-logo-full.png`, company: issuer()
    });
    await emailQueue.enqueue({ to: row.email, subject: mail.subject, text: mail.text, html: mail.html, kind: "receipt" }, client);
  }

  app.get("/api/tickets/codes/:codeId/qr.png", async (req, res) => {
    const codeId = parseId(req.params.codeId);
    const given = String(req.query.s || "");
    if (!codeId || given.length !== 32 || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(qrSignature(codeId)))) {
      return res.status(404).end();
    }
    const ticket = (await pool.query(`
      SELECT t.event_id,c.code FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
      WHERE c.id=$1 AND ${VALID_TICKET} AND t.event_id IS NOT NULL`, [codeId])).rows[0];
    if (!ticket) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=86400");
    res.type("png").send(await qrPng(ticket.event_id, ticket.code));
  });

  // Quem organiza: quem criou o evento ou quem gere a página do evento.
  const organizerSql = "(e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2))";
  // Lugares ocupados: entradas pagas e pagamentos a meio dos últimos 30 minutos (guardam o lugar).
  const takenSql = `COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id
    AND (${VALID_TICKET} OR (t.status='pending' AND t.created_at > NOW() - make_interval(mins => ${PENDING_HOLD_MINUTES})))), 0)::int`;

  // Comprar: cria a compra (com a quantidade) e abre o pagamento escolhido. Pode-se comprar mais do que uma vez.
  app.post("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const body = isRecord(req.body) ? req.body : {};
    const quantity = parseQuantity(body.quantity);
    if (!quantity) return res.status(400).json({ error: `Escolhe entre 1 e ${MAX_PER_ORDER} bilhetes por compra.` });
    const prepared = await transaction(async client => {
      const event = (await client.query(`
        SELECT e.id,e.name,e.creator_id,e.ticket_price_kz::float AS price,e.tickets_total,e.starts_at,${takenSql} AS taken
        FROM events e
        WHERE e.id=$1 AND NOT ${blockedBetween("$2", "e.creator_id")}
          AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))
        FOR UPDATE OF e`, [eventId, req.user.id])).rows[0];
      if (!event) return { status: 404, error: "Evento não encontrado." };
      if (!event.price) return { status: 409, error: "Este evento é grátis: carrega em «Vou»." };
      if (event.creator_id === req.user.id) return { status: 400, error: "Não precisas de bilhete para o teu próprio evento." };
      if (new Date(event.starts_at).getTime() <= Date.now()) return { status: 409, error: "Este evento já começou: já não se vendem bilhetes." };
      // Lugares guardados por pagamentos a meio: no máximo 10 por pessoa ao mesmo tempo, para ninguém conseguir
      // "esgotar" um evento só a pedir compras sem pagar.
      const holding = (await client.query(`
        SELECT COALESCE(SUM(quantity),0)::int AS n FROM event_tickets
        WHERE event_id=$1 AND user_id=$2 AND status='pending' AND created_at > NOW() - make_interval(mins => ${PENDING_HOLD_MINUTES})`,
      [eventId, req.user.id])).rows[0].n;
      if (holding + quantity > MAX_PER_ORDER) {
        return { status: 429, error: "Já tens um pagamento de bilhetes a meio para este evento. Conclui-o ou espera 30 minutos." };
      }
      if (event.tickets_total) {
        const left = event.tickets_total - event.taken;
        if (left <= 0) return { status: 409, error: "Os bilhetes esgotaram." };
        if (quantity > left) return { status: 409, error: `Só ${left === 1 ? "resta 1 bilhete" : `restam ${left} bilhetes`}.` };
      }
      const available = new Date(new Date(event.starts_at).getTime() + 24 * 60 * 60 * 1000);
      const amount = Math.round(event.price * quantity * 100) / 100;
      const ticket = (await client.query(`
        INSERT INTO event_tickets(event_id,user_id,owner_id,event_name,amount_kz,quantity,status,stars,available_at)
        VALUES($1,$2,$3,$4,$5,$6,'pending',0,$7) RETURNING id::int AS id`,
      [eventId, req.user.id, event.creator_id, event.name, amount, quantity, available])).rows[0];
      return { ticketId: ticket.id, event, amount };
    });
    if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });
    const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
    const result = await payments.start({
      purpose: "event_ticket", refId: prepared.ticketId, amountKz: prepared.amount, userId: req.user.id, email: user.rows[0]?.email,
      method: body.method, phone: body.phone, promoCode: body.promoCode,
      name: `${quantity === 1 ? "Bilhete" : `${quantity} bilhetes`} «${prepared.event.name}»`,
      successPath: `/events/${eventId}?pagamento=sucesso`, cancelPath: `/events/${eventId}?pagamento=cancelado`,
      onSession: sessionId => pool.query("UPDATE event_tickets SET stripe_session_id=$2 WHERE id=$1", [prepared.ticketId, sessionId])
    });
    if (result.error) return res.status(503).json({ error: result.error });
    res.status(201).json(result);
  });

  // Pagamento confirmado: cada entrada da compra ganha o seu código e a pessoa passa a ir ao evento.
  // Se o pagamento chegar tarde (ex.: Referência paga dias depois) e o evento já não existir ou já não houver
  // lugar para todas as entradas, o dinheiro fica por devolver (Administração → Pagamentos) e não conta para quem organiza.
  payments.register("event_ticket", async (ticketId, details) => {
    const method = details.method || (details.paymentIntent ? "card" : "demo");
    const issued = await transaction(async client => {
      const ticket = (await client.query("SELECT id,event_id,user_id,owner_id,event_name,quantity FROM event_tickets WHERE id=$1 AND status='pending' FOR UPDATE",
        [ticketId])).rows[0];
      if (!ticket) return false; // já confirmado (confirmação repetida) ou desconhecido
      const event = ticket.event_id ? (await client.query(`
        SELECT e.tickets_total,
          COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.id<>$2 AND ${VALID_TICKET}), 0)::int AS sold
        FROM events e WHERE e.id=$1 FOR UPDATE OF e`, [ticket.event_id, ticketId])).rows[0] : null;
      const full = event?.tickets_total && event.sold + ticket.quantity > event.tickets_total;
      await client.query("UPDATE event_tickets SET status='paid', paid_at=NOW(), stripe_payment_intent=$2 WHERE id=$1", [ticketId, details.paymentIntent || null]);
      if (!event || full) {
        await client.query("UPDATE event_tickets SET refund_status='manual' WHERE id=$1", [ticketId]);
        // Fica por devolver: não há bilhetes, por isso não há email de bilhetes.
        await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'event_refund',$2)", [ticket.user_id, full
          ? `Os bilhetes para «${ticket.event_name}» esgotaram antes de o teu pagamento chegar. Vamos devolver-te o dinheiro.`
          : `O teu pagamento para «${ticket.event_name}» já não corresponde a bilhetes (o evento foi cancelado). Vamos devolver-te o dinheiro.`]);
        return false;
      }
      for (let made = 0, attempts = 0; made < ticket.quantity; attempts += 1) {
        if (attempts > ticket.quantity * 5) throw new Error("Não foi possível gerar os códigos dos bilhetes.");
        const inserted = await client.query("INSERT INTO event_ticket_codes(ticket_id,code) VALUES($1,$2) ON CONFLICT (code) DO NOTHING RETURNING id",
          [ticketId, ticketCode()]);
        made += inserted.rowCount;
      }
      const many = ticket.quantity > 1;
      await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [ticket.event_id, ticket.user_id]);
      await client.query("INSERT INTO notifications(user_id,type,text) VALUES($1,'payment',$2)", [ticket.user_id, many
        ? `Os teus ${ticket.quantity} bilhetes para «${ticket.event_name}» estão prontos. Cada pessoa entra com o seu QR.`
        : `O teu bilhete para «${ticket.event_name}» está pronto. Mostra o QR à entrada.`]);
      if (ticket.owner_id && ticket.owner_id !== ticket.user_id) {
        await client.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'event_ticket',$3)",
          [ticket.owner_id, ticket.user_id, `Comprou ${many ? `${ticket.quantity} bilhetes` : "um bilhete"} para «${ticket.event_name}». Os teus 85% ficam disponíveis 1 dia depois do evento.`]);
      }
      await queueTicketEmail(client, ticketId, method);
      return true;
    });
    if (issued) emailQueue?.kick();
  });

  // O QR de uma das próprias entradas (PNG). Leva a ligação de validação, nunca dados pessoais.
  app.get("/api/events/:eventId/tickets/mine/qr", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    const code = normalizeCode(req.query.code);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const ticket = (await pool.query(`
      SELECT c.code FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
      WHERE t.event_id=$1 AND t.user_id=$2 AND ${VALID_TICKET} AND ($3='' OR c.code=$3) ORDER BY c.id LIMIT 1`, [eventId, req.user.id, code])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Não tens bilhete para este evento." });
    res.set("Cache-Control", "private, no-store");
    res.type("png").send(await qrPng(eventId, ticket.code));
  });

  // Lista das compras (só quem organiza). Nunca leva os códigos: quem vê este ecrã à porta não pode
  // copiar um código e entrar com ele (os códigos só aparecem a quem comprou, nos bilhetes e no email).
  app.get("/api/events/:eventId/tickets", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const event = await pool.query(`SELECT e.id,e.tickets_total FROM events e WHERE e.id=$1 AND ${organizerSql}`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(403).json({ error: "Só quem organiza vê os bilhetes." });
    const tickets = await pool.query(`
      SELECT t.id::int AS id,t.quantity,t.amount_kz::float AS amount_kz,t.paid_at AS created_at,
        (SELECT COUNT(*) FROM event_ticket_codes c WHERE c.ticket_id=t.id AND c.checked_in_at IS NOT NULL)::int AS checked_in,
        u.username,u.display_name,u.avatar_url
      FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event_id=$1 AND ${VALID_TICKET} ORDER BY t.paid_at DESC LIMIT 1000`, [eventId]);
    const rows = tickets.rows;
    const gross = rows.reduce((sum, row) => sum + row.amount_kz, 0);
    res.json({
      tickets: rows,
      sold: rows.reduce((sum, row) => sum + row.quantity, 0),
      checked_in: rows.reduce((sum, row) => sum + row.checked_in, 0),
      gross_kz: Math.round(gross * 100) / 100,
      net_kz: ticketShareKz(gross),
      total: event.rows[0].tickets_total
    });
  });

  // Validar uma entrada à porta (código escrito ou lido do QR). Cada entrada só entra uma vez.
  app.post("/api/events/:eventId/check-in", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    const code = normalizeCode(req.body?.code);
    if (!eventId || code.length < 6) return res.status(400).json({ error: "Indica o código do bilhete." });
    const event = await pool.query(`SELECT e.id FROM events e WHERE e.id=$1 AND ${organizerSql}`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(403).json({ error: "Só quem organiza pode validar bilhetes." });
    const ticket = (await pool.query(`
      SELECT c.id,c.checked_in_at,t.quantity,u.username,u.display_name,u.avatar_url,
        (SELECT COUNT(*) FROM event_ticket_codes x WHERE x.ticket_id=t.id AND x.id<=c.id)::int AS position
      FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id JOIN users u ON u.id=t.user_id
      WHERE t.event_id=$1 AND c.code=$2 AND ${VALID_TICKET}`, [eventId, code])).rows[0];
    if (!ticket) return res.status(404).json({ error: "Bilhete inválido para este evento." });
    const person = { username: ticket.username, display_name: ticket.display_name, avatar_url: ticket.avatar_url };
    // "Bilhete 2 de 3" ajuda à porta quando alguém compra para um grupo.
    const of = ticket.quantity > 1 ? { position: ticket.position, quantity: ticket.quantity } : null;
    if (ticket.checked_in_at) return res.status(409).json({ error: "Este bilhete já entrou.", checked_in_at: ticket.checked_in_at, person, of });
    const marked = await pool.query("UPDATE event_ticket_codes SET checked_in_at=NOW(),checked_in_by=$2 WHERE id=$1 AND checked_in_at IS NULL", [ticket.id, req.user.id]);
    if (!marked.rowCount) return res.status(409).json({ error: "Este bilhete já entrou.", person, of });
    res.json({ ok: true, person, of });
  });
}

module.exports = {
  EVENT_TICKET_ORGANIZER_SHARE, MAX_PER_ORDER, MIN_TICKET_KZ, VALID_TICKET, checkInUrl, deleteBlockedReason, normalizeCode, parseQuantity,
  parseTicketInput, registerEventTickets, ticketCode, ticketShareKz
};
