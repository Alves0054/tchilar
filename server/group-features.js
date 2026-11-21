// Grupos por dentro: definições e regras, administradores e moderadores, convites, publicações fixadas,
// sondagens, chat, ficheiros, eventos do grupo e estatísticas de participação.
//
// Papéis: owner (quem criou; um só) > admin > moderator > member.
// - dono e administradores: mudam as definições e as regras, nomeiam moderadores (só o dono nomeia administradores);
// - moderadores: aprovam pedidos, convidam, fixam e escondem publicações, removem membros, apagam mensagens e ficheiros;
// - membros: publicam, conversam no chat, votam, criam eventos e sondagens e partilham ficheiros.
const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 };
const MANAGER = ["owner", "admin", "moderator"];

// Documentos aceites nos ficheiros do grupo (e a extensão com que ficam guardados).
const DOCUMENT_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/zip": ".zip",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

function registerGroupFeatures(app, deps) {
  const { pool, auth, parseId, isRecord, cleanText, transaction, blockedBetween, GROUP_FIELDS, documentUpload, signProtectedMedia, removeUpload, rateLimit,
    imageUpload, optimizeUpload } = deps;

  async function roleOf(groupId, userId) {
    if (!userId) return null;
    const result = await pool.query("SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, userId]);
    return result.rows[0]?.role || null;
  }
  // Carrega o grupo e o papel de quem pede; responde 404/403 e devolve null quando não pode.
  async function guard(req, res, minimum = "member") {
    const groupId = parseId(req.params.groupId);
    if (!groupId) { res.status(400).json({ error: "Grupo inválido." }); return null; }
    const group = await pool.query("SELECT id,name,owner_id,is_secret,invite_only,requires_approval FROM social_groups WHERE id=$1 AND hidden_at IS NULL", [groupId]);
    if (!group.rowCount) { res.status(404).json({ error: "Grupo não encontrado." }); return null; }
    const role = await roleOf(groupId, req.user?.id);
    if (!role) {
      // Num grupo secreto não se revela que existe.
      res.status(group.rows[0].is_secret ? 404 : 403).json({ error: group.rows[0].is_secret ? "Grupo não encontrado." : "Entra no grupo para veres isto." });
      return null;
    }
    if (RANK[role] < RANK[minimum]) { res.status(403).json({ error: "Só a equipa do grupo pode fazer isto." }); return null; }
    return { ...group.rows[0], role };
  }

  // ----- O grupo -----
  app.get("/api/groups/:groupId", deps.optionalAuth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
    const viewerId = req.user?.id || 0;
    const result = await pool.query(`
      SELECT ${GROUP_FIELDS},
        (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT mu.username, mu.display_name, mu.avatar_url FROM group_members m JOIN users mu ON mu.id=m.user_id
          WHERE m.group_id=g.id ORDER BY m.joined_at LIMIT 8) x) AS member_preview,
        (SELECT m.role FROM group_members m WHERE m.group_id=g.id AND m.user_id=$2) AS my_role,
        EXISTS(SELECT 1 FROM group_join_requests r WHERE r.group_id=g.id AND r.user_id=$2) AS has_requested,
        EXISTS(SELECT 1 FROM group_invites i WHERE i.group_id=g.id AND i.user_id=$2) AS has_invite,
        (SELECT COUNT(*) FROM group_join_requests r WHERE r.group_id=g.id)::int AS request_count
      FROM social_groups g JOIN users u ON u.id=g.owner_id
      WHERE g.id=$1 AND g.hidden_at IS NULL`, [groupId, viewerId]);
    const group = result.rows[0];
    if (!group || (group.is_secret && !group.my_role)) return res.status(404).json({ error: "Grupo não encontrado." });
    group.is_member = Boolean(group.my_role);
    if (!MANAGER.includes(group.my_role)) delete group.request_count;
    res.json({ group });
  });

  // Definições e regras (dono e administradores). Um grupo secreto continua secreto (tem entrada paga e +18).
  app.patch("/api/groups/:groupId", auth, async (req, res) => {
    const group = await guard(req, res, "admin");
    if (!group) return;
    const body = isRecord(req.body) ? req.body : {};
    const sets = [];
    const values = [group.id];
    const add = (column, value) => { values.push(value); sets.push(`${column}=$${values.length}`); };
    if (body.name !== undefined) {
      const name = cleanText(body.name);
      if (typeof body.name !== "string" || !name || name.length > 100) return res.status(400).json({ error: "O nome do grupo deve ter até 100 caracteres." });
      add("name", name);
    }
    for (const [key, column, max] of /** @type {Array<[string, string, number]>} */ ([["description", "description", 2000], ["rules", "rules", 3000]])) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "string" || body[key].length > max) return res.status(400).json({ error: `O texto excede ${max} caracteres.` });
      add(column, cleanText(body[key]));
    }
    if (body.groupType !== undefined || body.category !== undefined || body.subcategory !== undefined) {
      const kind = deps.parseGroupKind(body.groupType, body.category, body.subcategory);
      if (kind.error) return res.status(400).json({ error: kind.error });
      add("group_type", kind.type); add("category", kind.category); add("subcategory", kind.subcategory);
    }
    if (body.privacy !== undefined) {
      if (group.is_secret || !["public", "approval", "private"].includes(body.privacy)) return res.status(400).json({ error: "Este grupo não pode mudar para esse tipo de entrada." });
      add("requires_approval", body.privacy === "approval"); add("invite_only", body.privacy === "private");
    }
    if (!sets.length) return res.status(400).json({ error: "Nada para mudar." });
    await pool.query(`UPDATE social_groups SET ${sets.join(",")} WHERE id=$1`, values);
    res.json({ updated: true });
  });

  // ----- Membros, papéis e convites -----
  app.get("/api/groups/:groupId/members", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,m.role,m.joined_at
      FROM group_members m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=$1 AND NOT ${blockedBetween("$2", "u.id")}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, m.joined_at
      LIMIT 500`, [group.id, req.user.id]);
    res.json({ members: result.rows, my_role: group.role });
  });

  // Mudar o papel de alguém: o dono nomeia administradores; administradores nomeiam moderadores.
  app.post("/api/groups/:groupId/members/:userId/role", auth, async (req, res) => {
    const group = await guard(req, res, "admin");
    if (!group) return;
    const userId = parseId(req.params.userId);
    const role = isRecord(req.body) ? req.body.role : undefined;
    if (!userId || !["admin", "moderator", "member"].includes(role)) return res.status(400).json({ error: "Papel inválido." });
    const target = await roleOf(group.id, userId);
    if (!target) return res.status(404).json({ error: "Essa pessoa não é membro do grupo." });
    if (target === "owner") return res.status(403).json({ error: "O papel do dono do grupo não muda." });
    if (group.role !== "owner" && (role === "admin" || target === "admin")) return res.status(403).json({ error: "Só o dono do grupo nomeia ou retira administradores." });
    await pool.query("UPDATE group_members SET role=$3 WHERE group_id=$1 AND user_id=$2", [group.id, userId, role]);
    if (role !== "member") {
      await pool.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)",
        [userId, req.user.id, `Agora és ${role === "admin" ? "administrador" : "moderador"} do grupo «${group.name}».`]);
    }
    res.json({ role });
  });

  // Remover alguém do grupo (só quem tem um papel abaixo do nosso).
  app.delete("/api/groups/:groupId/members/:userId", auth, async (req, res) => {
    const group = await guard(req, res, "moderator");
    if (!group) return;
    const userId = parseId(req.params.userId);
    const target = userId && await roleOf(group.id, userId);
    if (!target) return res.status(404).json({ error: "Essa pessoa não é membro do grupo." });
    if (RANK[target] >= RANK[group.role]) return res.status(403).json({ error: "Não podes remover alguém com o mesmo papel ou acima." });
    await pool.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2", [group.id, userId]);
    res.json({ removed: true });
  });

  // Convidar pelo nome de utilizador (em grupos privados é a única forma de entrar).
  app.post("/api/groups/:groupId/invites", auth, rateLimit, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    if (group.is_secret) return res.status(400).json({ error: "Nos grupos secretos a entrada é paga, não por convite." });
    // Num grupo privado só a equipa convida; nos outros qualquer membro pode convidar amigos.
    if (group.invite_only && !MANAGER.includes(group.role)) return res.status(403).json({ error: "Só a equipa do grupo convida para um grupo privado." });
    const username = typeof req.body?.username === "string" ? req.body.username.trim().replace(/^@/, "").toLowerCase() : "";
    const user = await pool.query(`SELECT id FROM users WHERE lower(username)=$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$2", "id")}`, [username, req.user.id]);
    if (!user.rowCount) return res.status(404).json({ error: "Não encontrámos essa pessoa." });
    const userId = user.rows[0].id;
    if (await roleOf(group.id, userId)) return res.status(409).json({ error: "Essa pessoa já é membro do grupo." });
    const inserted = await pool.query("INSERT INTO group_invites(group_id,user_id,invited_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id", [group.id, userId, req.user.id]);
    if (inserted.rowCount) {
      await pool.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)",
        [userId, req.user.id, `Convidou-te para o grupo «${group.name}». Abre Grupos para entrares.`]);
    }
    res.status(201).json({ invited: true });
  });

  // ----- Publicações fixadas e moderação de publicações -----
  app.post("/api/groups/:groupId/pins/:postId", auth, async (req, res) => {
    const group = await guard(req, res, "moderator");
    if (!group) return;
    const postId = parseId(req.params.postId);
    const pinned = await pool.query("SELECT COUNT(*)::int AS n FROM posts WHERE group_id=$1 AND pinned_at IS NOT NULL", [group.id]);
    if (pinned.rows[0].n >= 5) return res.status(409).json({ error: "Já há 5 publicações fixadas. Desafixa uma primeiro." });
    const result = await pool.query("UPDATE posts SET pinned_at=NOW() WHERE id=$1 AND group_id=$2 AND hidden_at IS NULL RETURNING id", [postId, group.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Publicação não encontrada neste grupo." });
    res.json({ pinned: true });
  });
  app.delete("/api/groups/:groupId/pins/:postId", auth, async (req, res) => {
    const group = await guard(req, res, "moderator");
    if (!group) return;
    await pool.query("UPDATE posts SET pinned_at=NULL WHERE id=$1 AND group_id=$2", [parseId(req.params.postId), group.id]);
    res.json({ pinned: false });
  });
  // Esconder uma publicação que não cumpre as regras do grupo (o autor continua a vê-la).
  app.post("/api/groups/:groupId/posts/:postId/hide", auth, async (req, res) => {
    const group = await guard(req, res, "moderator");
    if (!group) return;
    const result = await pool.query(
      "UPDATE posts SET hidden_at=NOW(),hidden_reason='group_rules',pinned_at=NULL WHERE id=$1 AND group_id=$2 AND hidden_at IS NULL RETURNING user_id",
      [parseId(req.params.postId), group.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Publicação não encontrada neste grupo." });
    await pool.query("INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,'group_join',$3)",
      [result.rows[0].user_id, req.user.id, `Uma publicação tua foi escondida no grupo «${group.name}» por não cumprir as regras.`]);
    res.json({ hidden: true });
  });

  // ----- Sondagens -----
  app.get("/api/groups/:groupId/polls", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query(`
      SELECT p.id,p.question,p.multiple,p.closes_at,p.created_at,p.author_id,
        u.username AS author_username,u.display_name AS author_name,
        (p.closes_at IS NOT NULL AND p.closes_at < NOW()) AS closed,
        (SELECT COUNT(DISTINCT v.user_id) FROM group_poll_votes v WHERE v.poll_id=p.id)::int AS voters,
        (SELECT json_agg(json_build_object('id',o.id,'label',o.label,
            'votes',(SELECT COUNT(*) FROM group_poll_votes v WHERE v.option_id=o.id)::int,
            'mine',EXISTS(SELECT 1 FROM group_poll_votes v WHERE v.option_id=o.id AND v.user_id=$2)) ORDER BY o.position)
          FROM group_poll_options o WHERE o.poll_id=p.id) AS options
      FROM group_polls p LEFT JOIN users u ON u.id=p.author_id
      WHERE p.group_id=$1 ORDER BY p.created_at DESC LIMIT 50`, [group.id, req.user.id]);
    res.json({ polls: result.rows, my_role: group.role });
  });
  app.post("/api/groups/:groupId/polls", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const body = isRecord(req.body) ? req.body : {};
    const question = cleanText(body.question);
    const options = Array.isArray(body.options) ? body.options.map(cleanText).filter(Boolean) : [];
    if (!question || question.length > 200) return res.status(400).json({ error: "Escreve a pergunta (até 200 caracteres)." });
    if (options.length < 2 || options.length > 10 || options.some(option => option.length > 100) || new Set(options.map(o => o.toLowerCase())).size !== options.length) {
      return res.status(400).json({ error: "Dá entre 2 e 10 respostas diferentes (até 100 caracteres cada)." });
    }
    const days = body.days === undefined || body.days === null ? null : Number(body.days);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 30)) return res.status(400).json({ error: "A sondagem fica aberta entre 1 e 30 dias." });
    const poll = await transaction(async client => {
      const created = (await client.query(
        "INSERT INTO group_polls(group_id,author_id,question,multiple,closes_at) VALUES($1,$2,$3,$4,CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + ($5::int * INTERVAL '1 day') END) RETURNING id",
        [group.id, req.user.id, question, body.multiple === true, days])).rows[0];
      for (const [index, label] of options.entries()) {
        await client.query("INSERT INTO group_poll_options(poll_id,label,position) VALUES($1,$2,$3)", [created.id, label, index]);
      }
      return created;
    });
    res.status(201).json({ poll });
  });
  // Votar (ou mudar o voto). optionIds vazio retira o voto.
  app.post("/api/groups/:groupId/polls/:pollId/vote", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const pollId = parseId(req.params.pollId);
    const poll = await pool.query("SELECT id,multiple,closes_at FROM group_polls WHERE id=$1 AND group_id=$2", [pollId, group.id]);
    if (!poll.rowCount) return res.status(404).json({ error: "Sondagem não encontrada." });
    if (poll.rows[0].closes_at && new Date(poll.rows[0].closes_at) < new Date()) return res.status(409).json({ error: "Esta sondagem já fechou." });
    const ids = Array.isArray(req.body?.optionIds) ? [...new Set(req.body.optionIds.map(Number))].filter(Number.isSafeInteger) : [];
    if (!poll.rows[0].multiple && ids.length > 1) return res.status(400).json({ error: "Nesta sondagem só se escolhe uma resposta." });
    const valid = await pool.query("SELECT id FROM group_poll_options WHERE poll_id=$1 AND id = ANY($2)", [pollId, ids]);
    if (valid.rowCount !== ids.length) return res.status(400).json({ error: "Resposta inválida." });
    await transaction(async client => {
      await client.query("DELETE FROM group_poll_votes WHERE poll_id=$1 AND user_id=$2", [pollId, req.user.id]);
      for (const id of ids) await client.query("INSERT INTO group_poll_votes(poll_id,option_id,user_id) VALUES($1,$2,$3)", [pollId, id, req.user.id]);
    });
    res.json({ voted: ids });
  });
  app.delete("/api/groups/:groupId/polls/:pollId", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query(
      "DELETE FROM group_polls WHERE id=$1 AND group_id=$2 AND (author_id=$3 OR $4) RETURNING id",
      [parseId(req.params.pollId), group.id, req.user.id, MANAGER.includes(group.role)]);
    if (!result.rowCount) return res.status(404).json({ error: "Sondagem não encontrada." });
    res.json({ deleted: true });
  });

  // ----- Chat do grupo (a app e o site vão buscando as mensagens novas) -----
  app.get("/api/groups/:groupId/chat", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const after = req.query.after === undefined ? null : parseId(req.query.after);
    const result = await pool.query(`
      SELECT * FROM (
        SELECT c.id,c.body,c.created_at,c.user_id,u.username,u.display_name,u.avatar_url
        FROM group_messages c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.group_id=$1 AND ($2::int IS NULL OR c.id>$2) AND NOT ${blockedBetween("$3", "c.user_id")}
        ORDER BY c.id DESC LIMIT 80) x ORDER BY id`, [group.id, after, req.user.id]);
    res.json({ messages: result.rows, my_role: group.role });
  });
  app.post("/api/groups/:groupId/chat", auth, rateLimit, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length > 2000) return res.status(400).json({ error: "A mensagem deve ter entre 1 e 2000 caracteres." });
    const result = await pool.query("INSERT INTO group_messages(group_id,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at,user_id", [group.id, req.user.id, body]);
    res.status(201).json({ message: result.rows[0] });
  });
  app.delete("/api/groups/:groupId/chat/:messageId", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query("DELETE FROM group_messages WHERE id=$1 AND group_id=$2 AND (user_id=$3 OR $4) RETURNING id",
      [parseId(req.params.messageId), group.id, req.user.id, MANAGER.includes(group.role)]);
    if (!result.rowCount) return res.status(404).json({ error: "Mensagem não encontrada." });
    res.json({ deleted: true });
  });

  // ----- Ficheiros e documentos (só membros; o link de descarga dura 30 minutos) -----
  app.get("/api/groups/:groupId/files", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query(`
      SELECT f.id,f.name,f.url,f.mime,f.size_bytes,f.created_at,f.user_id,u.username,u.display_name
      FROM group_files f LEFT JOIN users u ON u.id=f.user_id WHERE f.group_id=$1 ORDER BY f.created_at DESC LIMIT 200`, [group.id]);
    res.json({ files: result.rows.map(file => ({ ...file, url: signProtectedMedia("group-file", file.url, 30) })), my_role: group.role });
  });
  app.post("/api/groups/:groupId/files", auth, rateLimit, (req, res, next) => documentUpload.single("file")(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "O ficheiro tem mais de 25 MB." : error.message });
    next();
  }), async (req, res) => {
    const group = await guard(req, res);
    if (!group) { if (req.file) await removeUpload(`/uploads/${req.file.filename}`); return; }
    if (!req.file) return res.status(400).json({ error: "Escolhe um ficheiro." });
    // O nome original chega em latin1 pelo multipart; volta a UTF-8 para os acentos ficarem certos.
    const original = Buffer.from(req.file.originalname || "ficheiro", "latin1").toString("utf8").replace(/[\\/:*?"<>|]/g, "").replace(/\p{Cc}/gu, "").slice(0, 200) || "ficheiro";
    const result = await pool.query(
      "INSERT INTO group_files(group_id,user_id,name,url,mime,size_bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,mime,size_bytes,created_at",
      [group.id, req.user.id, original, `/uploads/${req.file.filename}`, req.file.mimetype, req.file.size]);
    res.status(201).json({ file: result.rows[0] });
  });
  app.delete("/api/groups/:groupId/files/:fileId", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query("DELETE FROM group_files WHERE id=$1 AND group_id=$2 AND (user_id=$3 OR $4) RETURNING url",
      [parseId(req.params.fileId), group.id, req.user.id, MANAGER.includes(group.role)]);
    if (!result.rowCount) return res.status(404).json({ error: "Ficheiro não encontrado." });
    await removeUpload(result.rows[0].url);
    res.json({ deleted: true });
  });

  // ----- Eventos e calendário do grupo -----
  app.get("/api/groups/:groupId/events", auth, async (req, res) => {
    const group = await guard(req, res);
    if (!group) return;
    const result = await pool.query(`
      SELECT e.id,e.name,e.description,e.location,e.image_url,e.starts_at,e.created_at,
        u.id AS creator_id,u.username AS creator_username,u.display_name AS creator_name,
        (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
        EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$2) AS is_attending
      FROM events e JOIN users u ON u.id=e.creator_id
      WHERE e.group_id=$1 AND e.starts_at >= NOW() - INTERVAL '1 day'
      ORDER BY e.starts_at ASC LIMIT 100`, [group.id, req.user.id]);
    res.json({ events: result.rows });
  });
  // Aceita JSON (apps antigas) ou multipart com uma imagem opcional ("image"), como os outros eventos.
  const eventImage = [imageUpload.single("image"), optimizeUpload("event")];
  app.post("/api/groups/:groupId/events", auth, ...eventImage, async (req, res) => {
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : "";
    const reject = async (status, error) => { if (imageUrl) await removeUpload(imageUrl); return res.status(status).json({ error }); };
    const group = await guard(req, res);
    if (!group) { if (imageUrl) await removeUpload(imageUrl); return; }
    const body = isRecord(req.body) ? req.body : {};
    const name = cleanText(body.name);
    const description = cleanText(body.description);
    const location = cleanText(body.location);
    const startsAt = new Date(body.startsAt);
    if (!name || name.length > 120) return reject(400, "O nome do evento é obrigatório e deve ter até 120 caracteres.");
    if (!body.startsAt || Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) return reject(400, "Indica uma data e hora no futuro.");
    if (description.length > 2000 || location.length > 160) return reject(400, "A descrição ou o local excedem o limite.");
    const event = await transaction(async client => {
      const created = (await client.query(
        "INSERT INTO events(creator_id,name,description,location,image_url,starts_at,group_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,description,location,image_url,starts_at,created_at",
        [req.user.id, name, description, location, imageUrl, startsAt.toISOString(), group.id])).rows[0];
      await client.query("INSERT INTO event_attendees(event_id,user_id) VALUES($1,$2)", [created.id, req.user.id]);
      await client.query(`INSERT INTO notifications(user_id,actor_id,type,text)
        SELECT m.user_id,$2,'group_join',$3 FROM group_members m WHERE m.group_id=$1 AND m.user_id<>$2`,
      [group.id, req.user.id, `Novo evento no grupo «${group.name}»: ${name}.`]);
      return created;
    });
    res.status(201).json({ event: { ...event, attendee_count: 1, is_attending: true } });
  });

  // ----- Estatísticas de participação (equipa do grupo) -----
  app.get("/api/groups/:groupId/stats", auth, async (req, res) => {
    const group = await guard(req, res, "moderator");
    if (!group) return;
    const [numbers, top, weekly] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM group_members WHERE group_id=$1)::int AS members,
          (SELECT COUNT(*) FROM group_members WHERE group_id=$1 AND joined_at > NOW() - INTERVAL '7 days')::int AS new_members_7d,
          (SELECT COUNT(*) FROM group_members WHERE group_id=$1 AND joined_at > NOW() - INTERVAL '30 days')::int AS new_members_30d,
          (SELECT COUNT(*) FROM posts WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days')::int AS posts_30d,
          (SELECT COUNT(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.group_id=$1 AND c.created_at > NOW() - INTERVAL '30 days')::int AS comments_30d,
          (SELECT COUNT(*) FROM group_messages WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days')::int AS messages_30d,
          (SELECT COUNT(*) FROM group_join_requests WHERE group_id=$1)::int AS pending_requests,
          (SELECT COUNT(DISTINCT x.user_id) FROM (
            SELECT user_id FROM posts WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days'
            UNION ALL SELECT c.user_id FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.group_id=$1 AND c.created_at > NOW() - INTERVAL '30 days'
            UNION ALL SELECT user_id FROM group_messages WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days'
            UNION ALL SELECT v.user_id FROM group_poll_votes v JOIN group_polls gp ON gp.id=v.poll_id WHERE gp.group_id=$1 AND v.created_at > NOW() - INTERVAL '30 days'
          ) x)::int AS active_30d`, [group.id]),
      pool.query(`
        SELECT u.username,u.display_name,u.avatar_url,COUNT(*)::int AS actions FROM (
          SELECT user_id FROM posts WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days'
          UNION ALL SELECT c.user_id FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.group_id=$1 AND c.created_at > NOW() - INTERVAL '30 days'
          UNION ALL SELECT user_id FROM group_messages WHERE group_id=$1 AND created_at > NOW() - INTERVAL '30 days'
        ) x JOIN users u ON u.id=x.user_id GROUP BY u.id ORDER BY actions DESC LIMIT 5`, [group.id]),
      pool.query(`
        SELECT to_char(w.week,'YYYY-MM-DD') AS week,
          (SELECT COUNT(*) FROM posts p WHERE p.group_id=$1 AND p.created_at >= w.week AND p.created_at < w.week + INTERVAL '7 days')::int AS posts,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=$1 AND m.joined_at >= w.week AND m.joined_at < w.week + INTERVAL '7 days')::int AS joins
        FROM generate_series(date_trunc('week', NOW()) - INTERVAL '7 weeks', date_trunc('week', NOW()), INTERVAL '1 week') AS w(week)`, [group.id])
    ]);
    res.json({ stats: numbers.rows[0], top: top.rows, weekly: weekly.rows });
  });
}

module.exports = { DOCUMENT_TYPES, registerGroupFeatures };
