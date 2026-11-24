// Eventos: agenda, criar, editar, «Vou» e apagar (os bilhetes estão em event-tickets.js).
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { blockedBetween } = require("./moderation");
const { deleteBlockedReason } = require("./event-tickets");
const { optimizeUpload } = require("./images");
const { parseSellerInput } = require("./event-tickets");
const { parseTicketInput } = require("./event-tickets");

function registerEventRoutes(app, deps) {
  const {
    auth, cleanText, imageUpload, isRecord, optionalAuth, parseId, pool, removeUpload, transaction
  } = deps;

  app.get("/api/events", optionalAuth, async (req, res) => {
    const pageId = req.query.pageId === undefined ? null : parseId(req.query.pageId);
    if (req.query.pageId !== undefined && !pageId) return res.status(400).json({ error: "Página inválida." });
    const result = await pool.query(`
      SELECT e.id,e.page_id,p.name AS page_name,e.name,e.description,e.location,e.image_url,e.starts_at,e.created_at,
        u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,
        e.ticket_price_kz::float AS ticket_price_kz,e.tickets_total,
        COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS tickets_sold,
        (SELECT COALESCE(json_agg(json_build_object('code',c.code,'checked_in_at',c.checked_in_at) ORDER BY c.id), '[]'::json)
          FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
          WHERE t.event_id=e.id AND t.user_id=$1 AND t.status='paid' AND t.refund_status IS NULL) AS my_tickets,
        (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
        EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$1) AS is_attending
      FROM events e JOIN users u ON u.id=e.creator_id LEFT JOIN pages p ON p.id=e.page_id
      WHERE e.starts_at >= NOW() - INTERVAL '1 day' AND e.group_id IS NULL
        AND ($2::int IS NULL OR e.page_id=$2)
      ORDER BY e.starts_at ASC LIMIT 100`, [req.user?.id || 0, pageId]);
    res.json({ events: result.rows });
  });

  app.post("/api/events", auth, imageUpload.single("image"), optimizeUpload("event"), async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
    const reject = async (status, error) => {
      if (imageUrl) await removeUpload(imageUrl);
      return res.status(status).json({ error });
    };
    try {
      if (typeof body.name !== "string") return reject(400, "O nome do evento é obrigatório.");
      const name = cleanText(body.name);
      const description = cleanText(body.description);
      const location = cleanText(body.location);
      const startsAt = new Date(body.startsAt);
      if (!name || name.length > 120) return reject(400, "O nome do evento é obrigatório e deve ter até 120 caracteres.");
      if (!body.startsAt || Number.isNaN(startsAt.getTime())) return reject(400, "Indica uma data e hora válidas.");
      if (startsAt <= new Date()) return reject(400, "O evento deve começar no futuro.");
      if ((body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000))
        || (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 160))) {
        return reject(400, "A descrição ou localização excede o limite permitido.");
      }
      const pageId = body.pageId === undefined || body.pageId === null || body.pageId === "" ? null : parseId(body.pageId);
      if (body.pageId !== undefined && body.pageId !== null && body.pageId !== "" && !pageId) return reject(400, "Página inválida.");
      if (pageId) {
        const page = await pool.query("SELECT 1 FROM pages WHERE id=$1 AND owner_id=$2 AND hidden_at IS NULL", [pageId, req.user.id]);
        if (!page.rowCount) return reject(403, "Só o responsável pela página pode criar eventos nela.");
      }
      // Bilhete pago com dinheiro (0 = grátis, com o botão "Vou"). Quem organiza fica com 85%.
      const ticket = parseTicketInput(body);
      if (ticket.error) return reject(400, ticket.error);
      // Eventos pagos: quem vende (nome/empresa, NIF e morada) aparece no recibo de cada bilhete.
      const seller = ticket.price ? parseSellerInput(body, cleanText) : null;
      if (seller?.error) return reject(400, seller.error);
      const event = await transaction(async client => {
        const result = await client.query(`
          INSERT INTO events(creator_id,page_id,name,description,location,image_url,starts_at,ticket_price_kz,tickets_total,seller_name,seller_nif,seller_address)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,page_id,name,description,location,image_url,starts_at,created_at,ticket_price_kz::float AS ticket_price_kz,tickets_total,
            seller_name,seller_nif,seller_address`,
        [req.user.id, pageId, name, description, location, imageUrl, startsAt.toISOString(), ticket.price, ticket.total,
          seller?.name || null, seller?.nif || null, seller?.address || null]);
        // Os dados ficam guardados na conta para preencher os próximos eventos.
        if (seller) await client.query("UPDATE users SET billing_name=$2,billing_nif=$3,billing_address=$4 WHERE id=$1", [req.user.id, seller.name, seller.nif, seller.address]);
        await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2)", [result.rows[0].id, req.user.id]);
        return result.rows[0];
      });
      res.status(201).json({ event: { ...event, creator_id: req.user.id, attendee_count: 1, is_attending: true, tickets_sold: 0, my_tickets: [] } });
    } catch (error) {
      if (imageUrl) await removeUpload(imageUrl);
      throw error;
    }
  });

  app.post("/api/events/:eventId/rsvp", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    // Eventos de um grupo: só os membros do grupo confirmam presença.
    const event = await pool.query(`SELECT creator_id,ticket_price_kz::float AS ticket_price_kz FROM events e WHERE id=$1
      AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`, [eventId, req.user.id]);
    if (!event.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
    if (event.rows[0].ticket_price_kz > 0 && event.rows[0].creator_id !== req.user.id) {
      return res.status(409).json({ error: "Este evento tem bilhete: compra-o para garantires o lugar." });
    }
    const attending = await transaction(async client => {
      const existing = await client.query(
        "DELETE FROM event_attendees WHERE event_id=$1 AND user_id=$2 RETURNING event_id",
        [eventId, req.user.id]);
      if (existing.rowCount) return false;
      const inserted = await client.query(
        "INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [eventId, req.user.id]);
      if (inserted.rowCount && event.rows[0].creator_id !== req.user.id) {
        await client.query(`
          INSERT INTO notifications(user_id,actor_id,type,text)
          VALUES($1,$2,'event_rsvp','Vai participar no teu evento.')`, [event.rows[0].creator_id, req.user.id]);
      }
      return true;
    });
    res.json({ attending });
  });

  // Um evento: dados, quem criou e quem vai (amigos e quem segues primeiro). Quem tem bloqueio não aparece.
  app.get("/api/events/:eventId", optionalAuth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const viewer = req.user?.id || 0;
    const event = await pool.query(`
      SELECT e.id,e.page_id,p.name AS page_name,e.name,e.description,e.location,e.image_url,e.starts_at,e.created_at,
        u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,u.avatar_url AS creator_avatar,
        e.ticket_price_kz::float AS ticket_price_kz,e.tickets_total,e.seller_name,
        CASE WHEN e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2) THEN e.seller_nif END AS seller_nif,
        CASE WHEN e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2) THEN e.seller_address END AS seller_address,
        COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS tickets_sold,
        (SELECT COALESCE(json_agg(json_build_object('code',c.code,'checked_in_at',c.checked_in_at) ORDER BY c.id), '[]'::json)
          FROM event_ticket_codes c JOIN event_tickets t ON t.id=c.ticket_id
          WHERE t.event_id=e.id AND t.user_id=$2 AND t.status='paid' AND t.refund_status IS NULL) AS my_tickets,
        (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
        EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$2) AS is_attending,
        (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages pg WHERE pg.id=e.page_id AND pg.owner_id=$2)) AS is_creator
      FROM events e JOIN users u ON u.id=e.creator_id LEFT JOIN pages p ON p.id=e.page_id
      WHERE e.id=$1 AND NOT ${blockedBetween("$2", "e.creator_id")}
        AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`, [eventId, viewer]);
    if (!event.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
    const attendees = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,
        EXISTS(SELECT 1 FROM friendships f WHERE (f.user_a_id=$2 AND f.user_b_id=u.id) OR (f.user_b_id=$2 AND f.user_a_id=u.id)) AS is_friend
      FROM event_attendees a JOIN users u ON u.id=a.user_id
      WHERE a.event_id=$1 AND u.suspended_at IS NULL AND NOT ${blockedBetween("$2", "u.id")}
      ORDER BY is_friend DESC, (EXISTS(SELECT 1 FROM follows fo WHERE fo.follower_id=$2 AND fo.following_id=u.id)) DESC, u.display_name
      LIMIT 60`, [eventId, viewer]);
    res.json({ event: event.rows[0], attendees: attendees.rows });
  });

  // Editar um evento (quem o criou ou quem gere a página): nome, data, local, descrição e lotação.
  // O preço não muda depois de criado (quem já comprou pagou esse preço). A lotação nunca fica abaixo do já vendido.
  // Se a data ou o local mudarem, quem vai e quem tem bilhete é avisado, e os lembretes voltam a ser enviados.
  app.patch("/api/events/:eventId", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    const body = isRecord(req.body) ? req.body : {};
    const current = (await pool.query(`
      SELECT e.id,e.name,e.description,e.location,e.starts_at,e.tickets_total,e.ticket_price_kz::float AS price,
        COALESCE((SELECT SUM(t.quantity) FROM event_tickets t WHERE t.event_id=e.id AND t.status='paid' AND t.refund_status IS NULL), 0)::int AS sold
      FROM events e WHERE e.id=$1 AND (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages p WHERE p.id=e.page_id AND p.owner_id=$2))
        AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=e.group_id AND gm.user_id=$2))`,
    [eventId, req.user.id])).rows[0];
    if (!current) return res.status(404).json({ error: "Evento não encontrado." });
    if (new Date(current.starts_at).getTime() < Date.now() - 6 * 3600000) return res.status(409).json({ error: "Este evento já aconteceu: já não se edita." });
    const next = { name: current.name, description: current.description, location: current.location, startsAt: new Date(current.starts_at), total: current.tickets_total };
    if (body.name !== undefined) {
      const name = cleanText(body.name);
      if (!name || name.length > 120) return res.status(400).json({ error: "O nome do evento é obrigatório e deve ter até 120 caracteres." });
      next.name = name;
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 2000) return res.status(400).json({ error: "A descrição pode ter até 2000 caracteres." });
      next.description = cleanText(body.description);
    }
    if (body.location !== undefined) {
      if (typeof body.location !== "string" || body.location.length > 160) return res.status(400).json({ error: "O local pode ter até 160 caracteres." });
      next.location = cleanText(body.location);
    }
    if (body.startsAt !== undefined) {
      const startsAt = new Date(body.startsAt);
      if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ error: "Indica uma data e hora válidas." });
      if (startsAt <= new Date()) return res.status(400).json({ error: "O evento deve começar no futuro." });
      next.startsAt = startsAt;
    }
    let seller = null;
    if (current.price > 0 && (body.sellerName !== undefined || body.sellerNif !== undefined || body.sellerAddress !== undefined)) {
      seller = parseSellerInput(body, cleanText);
      if (seller.error) return res.status(400).json({ error: seller.error });
    }
    if (body.ticketsTotal !== undefined && current.price > 0) {
      const total = body.ticketsTotal === null || body.ticketsTotal === "" ? null : Number(body.ticketsTotal);
      if (total !== null && (!Number.isInteger(total) || total < 1 || total > 100000)) return res.status(400).json({ error: "Indica quantos bilhetes há (pelo menos 1)." });
      if (total !== null && total < current.sold) return res.status(409).json({ error: `Já vendeste ${current.sold} bilhetes: a lotação não pode ser menor.` });
      next.total = total;
    }
    const moved = next.startsAt.getTime() !== new Date(current.starts_at).getTime();
    const relocated = (next.location || "") !== (current.location || "");
    const updated = await transaction(async client => {
      const row = (await client.query(`
        UPDATE events SET name=$2,description=$3,location=$4,starts_at=$5,tickets_total=$6,
          seller_name=COALESCE($7,seller_name),seller_nif=COALESCE($8,seller_nif),seller_address=CASE WHEN $7::text IS NULL THEN seller_address ELSE $9 END
        WHERE id=$1
        RETURNING id,name,description,location,starts_at,tickets_total,seller_name,seller_nif,seller_address`,
      [eventId, next.name, next.description, next.location, next.startsAt.toISOString(), next.total, seller?.name || null, seller?.nif || null, seller?.address || null])).rows[0];
      if (seller) await client.query("UPDATE users SET billing_name=$2,billing_nif=$3,billing_address=$4 WHERE id=$1", [req.user.id, seller.name, seller.nif, seller.address]);
      // Os bilhetes passam a poder ser levantados 1 dia depois da nova data, mas nunca mais cedo do que antes
      // (antecipar a data não pode encurtar a espera do dinheiro).
      if (moved) {
        await client.query("UPDATE event_tickets SET available_at=GREATEST(available_at, $2::timestamptz + INTERVAL '1 day') WHERE event_id=$1",
          [eventId, next.startsAt.toISOString()]);
        await client.query("DELETE FROM event_reminders_sent WHERE event_id=$1", [eventId]);
      }
      if (moved || relocated) {
        const when = next.startsAt.toLocaleString("pt-PT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Luanda" });
        const change = [moved ? `nova data: ${when}` : null, relocated ? `novo local: ${next.location || "a anunciar"}` : null].filter(Boolean).join("; ");
        await client.query(`
          INSERT INTO notifications(user_id,actor_id,type,text,event_id)
          SELECT DISTINCT people.user_id,$2::int,'event_update',$3::text,$1::int FROM (
            SELECT user_id FROM event_attendees WHERE event_id=$1
            UNION SELECT user_id FROM event_tickets WHERE event_id=$1 AND status='paid' AND refund_status IS NULL
          ) people WHERE people.user_id<>$2::int`,
        [eventId, req.user.id, `O evento «${next.name}» mudou (${change}). Os teus bilhetes continuam válidos.`]);
      }
      return row;
    });
    res.json({ event: updated, notified: moved || relocated });
  });

  app.delete("/api/events/:eventId", auth, async (req, res) => {
    const eventId = parseId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: "Evento inválido." });
    // Se houver bilhetes vendidos, as estrelas voltam a quem comprou (gatilho da migração 071).
    const result = await transaction(async client => {
      const owned = await client.query(`SELECT e.id FROM events e
        WHERE e.id=$1 AND (e.creator_id=$2 OR EXISTS(SELECT 1 FROM pages p WHERE p.id=e.page_id AND p.owner_id=$2)) FOR UPDATE`, [eventId, req.user.id]);
      if (!owned.rowCount) return owned;
      const blocked = await deleteBlockedReason(client, eventId);
      if (blocked) return { blocked };
      return client.query("DELETE FROM events WHERE id=$1 RETURNING id,image_url", [eventId]);
    });
    if (result.blocked) return res.status(409).json({ error: result.blocked });
    if (!result.rowCount) return res.status(404).json({ error: "Evento não encontrado." });
    await removeUpload(result.rows[0].image_url);
    res.json({ deleted: true });
  });
}

module.exports = { registerEventRoutes };
