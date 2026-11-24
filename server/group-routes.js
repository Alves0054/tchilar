// Grupos: lista, criar, entrar, pagar a entrada, pedidos, sair e apagar.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const { adultSql, canRenewGroupAccess, parseAccessBilling } = require("./groups");
const { blockedBetween } = require("./moderation");
const { makeRateLimit } = require("./rate-limit");
const { parseAccessPrice } = require("./groups");
const { parseGroupKind } = require("./community-types");
const { parseGroupPrivacy } = require("./community-types");
const { sameGroupName } = require("./groups");

function registerGroupRoutes(app, deps) {
  const {
    GROUP_FIELDS, auth, cleanText, isRecord, optionalAuth, parseId, payments, pool, removeUpload, transaction
  } = deps;

  // Idade de quem pede: os grupos secretos são só para maiores de 18 (sem data de nascimento conta como menor).
  async function viewerAge(userId) {
    if (!userId) return { adult: false, hasBirthDate: false };
    const result = await pool.query(`SELECT birth_date IS NOT NULL AS has_birth_date, ${adultSql("birth_date")} AS adult FROM users WHERE id=$1`, [userId]);
    return { adult: Boolean(result.rows[0]?.adult), hasBirthDate: Boolean(result.rows[0]?.has_birth_date) };
  }

  // Os grupos secretos nunca aparecem na lista: só os vê quem já é membro (e é maior de idade).
  app.get("/api/groups", optionalAuth, async (req, res) => {
    const viewerId = req.user?.id || 0;
    const [result, viewer] = await Promise.all([pool.query(`
      SELECT ${GROUP_FIELDS},
        (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
          SELECT mu.username, mu.display_name, mu.avatar_url FROM group_members m JOIN users mu ON mu.id=m.user_id
          WHERE m.group_id=g.id ORDER BY m.joined_at LIMIT 5) x) AS member_preview,
        EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS is_member,
        EXISTS(SELECT 1 FROM group_join_requests r WHERE r.group_id=g.id AND r.user_id=$1) AS has_requested,
        (SELECT m.role FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1) AS my_role,
        CASE WHEN EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1 AND m.role IN ('owner','admin','moderator'))
          THEN (SELECT COUNT(*) FROM group_join_requests r WHERE r.group_id=g.id)::int ELSE 0 END AS pending_requests,
        EXISTS(SELECT 1 FROM group_invites i WHERE i.group_id=g.id AND i.user_id=$1) AS has_invite
      FROM social_groups g JOIN users u ON u.id=g.owner_id
      WHERE g.hidden_at IS NULL AND (NOT g.is_secret OR (
        EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1)
        AND EXISTS(SELECT 1 FROM users me WHERE me.id=$1 AND ${adultSql("me.birth_date")})))
      ORDER BY g.created_at DESC LIMIT 100`, [viewerId]), viewerAge(req.user?.id)]);
    res.json({ groups: result.rows, viewer });
  });

  // Procura de grupos secretos: só pelo nome exato e só para maiores de 18. Para um menor (ou sem data
  // de nascimento) a resposta é sempre vazia, sem dizer se o grupo existe.
  const groupSearchRateLimit = makeRateLimit("groupSearch", {
    windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Demasiadas pesquisas. Espera um minuto." }
  });
  app.get("/api/groups/secret", auth, groupSearchRateLimit, async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const viewer = await viewerAge(req.user.id);
    if (!viewer.adult || name.length < 3 || name.length > 100) return res.json({ groups: [], viewer });
    const result = await pool.query(`
      SELECT ${GROUP_FIELDS}, '[]'::json AS member_preview,
        EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$2) AS is_member,
        (SELECT m.access_until FROM group_members m WHERE m.group_id=g.id AND m.user_id=$2) AS my_access_until
      FROM social_groups g JOIN users u ON u.id=g.owner_id
      WHERE g.is_secret AND g.hidden_at IS NULL AND lower(g.name)=lower($1)
      ORDER BY g.created_at DESC LIMIT 10`, [name, req.user.id]);
    res.json({ groups: result.rows, viewer });
  });

  app.post("/api/groups", auth, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const name = cleanText(body.name);
    const description = cleanText(body.description);
    if (!name || name.length > 100) return res.status(400).json({ error: "O nome do grupo é obrigatório e deve ter até 100 caracteres." });
    if ((body.description !== undefined && typeof body.description !== "string") || description.length > 2000) {
      return res.status(400).json({ error: "A descrição excede 2000 caracteres." });
    }
    const privacy = parseGroupPrivacy(body);
    if (privacy.error) return res.status(400).json({ error: privacy.error });
    const kind = parseGroupKind(body.groupType, body.category, body.subcategory);
    if (kind.error) return res.status(400).json({ error: kind.error });
    const rules = cleanText(body.rules);
    if ((body.rules !== undefined && typeof body.rules !== "string") || rules.length > 3000) return res.status(400).json({ error: "As regras devem ter até 3000 caracteres." });
    const isSecret = privacy.value === "secret";
    const requiresApproval = privacy.value === "approval";
    const inviteOnly = privacy.value === "private";
    let accessPrice = null;
    let accessBilling = "once";
    if (isSecret) {
      if (!(await viewerAge(req.user.id)).adult) {
        return res.status(403).json({ error: "Só maiores de 18 anos podem criar grupos secretos. Confirma a tua data de nascimento nas Definições." });
      }
      if (name.length < 3) return res.status(400).json({ error: "O nome de um grupo secreto deve ter pelo menos 3 caracteres." });
      const billing = parseAccessBilling(body.accessBilling);
      if (billing.error) return res.status(400).json({ error: billing.error });
      accessBilling = billing.value;
      const price = parseAccessPrice(body.accessPrice, accessBilling);
      if (price.error) return res.status(400).json({ error: price.error });
      accessPrice = price.value;
    }
    const group = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO social_groups(owner_id,name,description,is_secret,access_price,requires_approval,invite_only,group_type,category,subcategory,rules,access_billing)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id,name,description,created_at,is_secret,access_price::float AS access_price,access_billing,requires_approval,invite_only,group_type,category,subcategory,rules`,
        [req.user.id, name, description, isSecret, accessPrice, requiresApproval, inviteOnly, kind.type, kind.category, kind.subcategory, rules, accessBilling]);
      await client.query(
        "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
        [result.rows[0].id, req.user.id]);
      return result.rows[0];
    });
    res.status(201).json({ group: { ...group, member_count: 1, is_member: true } });
  });

  app.post("/api/groups/:groupId/join", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
    const group = await pool.query("SELECT owner_id,is_secret,requires_approval,invite_only FROM social_groups WHERE id=$1 AND hidden_at IS NULL", [groupId]);
    // Num grupo secreto só se entra pagando (POST /access); a resposta não revela que o grupo existe.
    if (!group.rowCount || group.rows[0].is_secret) return res.status(404).json({ error: "Grupo não encontrado." });
    // Grupo privado: só entra quem tem convite (o convite é usado ao entrar).
    if (group.rows[0].invite_only && group.rows[0].owner_id !== req.user.id) {
      const invited = await pool.query("DELETE FROM group_invites WHERE group_id=$1 AND user_id=$2 RETURNING group_id", [groupId, req.user.id]);
      if (!invited.rowCount) {
        const member = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
        if (member.rowCount) return res.json({ joined: true });
        return res.status(403).json({ error: "Este grupo é privado: só entra quem um administrador convidar." });
      }
    }
    // Num grupo privado fica um pedido à espera do dono (quem já é membro não pede outra vez).
    if (group.rows[0].requires_approval && group.rows[0].owner_id !== req.user.id) {
      const member = await pool.query("SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
      if (member.rowCount) return res.json({ joined: true });
      const request = await pool.query(
        "INSERT INTO group_join_requests(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id",
        [groupId, req.user.id]);
      if (request.rowCount) {
        await pool.query(`
          INSERT INTO notifications(user_id,actor_id,type,text)
          SELECT m.user_id,$2,'group_join','Pediu para entrar num grupo que administras.' FROM group_members m
          WHERE m.group_id=$1 AND m.role IN ('owner','admin','moderator')`, [groupId, req.user.id]);
      }
      return res.status(202).json({ requested: true });
    }
    const result = await pool.query(
      "INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING group_id",
      [groupId, req.user.id]);
    if (result.rowCount && group.rows[0].owner_id !== req.user.id) {
      await pool.query(`
        INSERT INTO notifications(user_id,actor_id,type,text)
        VALUES($1,$2,'group_join','Juntou-se ao teu grupo.')`, [group.rows[0].owner_id, req.user.id]);
    }
    res.json({ joined: true });
  });

  // Entrada paga num grupo secreto. Pede o nome exato (além do número), para que só entre quem o conhece.
  app.post("/api/groups/:groupId/access", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    const body = isRecord(req.body) ? req.body : {};
    if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
    const viewer = await viewerAge(req.user.id);
    const group = await pool.query("SELECT id,name,owner_id,is_secret,access_price,access_billing FROM social_groups WHERE id=$1 AND hidden_at IS NULL", [groupId]);
    const found = group.rows[0];
    if (!viewer.adult || !found?.is_secret || !sameGroupName(body.name, found.name)) {
      return res.status(404).json({ error: "Grupo não encontrado." });
    }
    // Grupo mensal: quem já é membro pode pagar o mês seguinte nos últimos 7 dias do acesso.
    const monthly = found.access_billing === "monthly";
    const member = (await pool.query("SELECT role,access_until FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id])).rows[0];
    const renewing = Boolean(member) && monthly && member.role === "member" && canRenewGroupAccess(member.access_until);
    if (member && !renewing) {
      return res.status(409).json({ error: monthly && member.role === "member" && member.access_until
        ? "Já tens acesso. Podes renovar nos últimos 7 dias antes do fim."
        : "Já és membro deste grupo." });
    }
    const user = await pool.query("SELECT email FROM users WHERE id=$1", [req.user.id]);
    const purchase = await pool.query(
      "INSERT INTO group_access_purchases(group_id,user_id,owner_id,amount_kz,billing) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [groupId, req.user.id, found.owner_id, found.access_price, found.access_billing]);
    const id = purchase.rows[0].id;
    const result = await payments.start({
      purpose: "group_access", refId: id, amountKz: Number(found.access_price), userId: req.user.id, email: user.rows[0]?.email,
      method: body.method, phone: body.phone, promoCode: body.promoCode,
      name: monthly ? `Mensalidade do grupo ${found.name} (1 mês)` : `Entrada no grupo ${found.name}`,
      successPath: `/groups/${groupId}?pagamento=sucesso`, cancelPath: "/groups?pagamento=cancelado",
      onSession: sessionId => pool.query("UPDATE group_access_purchases SET stripe_session_id=$2 WHERE id=$1", [id, sessionId])
    });
    if (result.error) return res.status(503).json({ error: result.error });
    res.status(201).json(result);
  });

  app.post("/api/groups/:groupId/leave", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
    const group = await pool.query("SELECT owner_id FROM social_groups WHERE id=$1", [groupId]);
    if (!group.rowCount) return res.status(404).json({ error: "Grupo não encontrado." });
    if (group.rows[0].owner_id === req.user.id) {
      return res.status(409).json({ error: "És o responsável pelo grupo: apaga o grupo em vez de sair." });
    }
    await pool.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
    // Sair também retira um pedido de entrada que ainda esteja à espera.
    await pool.query("DELETE FROM group_join_requests WHERE group_id=$1 AND user_id=$2", [groupId, req.user.id]);
    res.json({ left: true });
  });

  // Pedidos de entrada num grupo privado: só o dono os vê e decide.
  // Grupo que esta pessoa gere: dono, administrador ou moderador (aprovam pedidos de entrada).
  async function ownedGroup(groupId, userId) {
    const result = await pool.query(`SELECT g.id,g.name FROM social_groups g JOIN group_members m ON m.group_id=g.id
      WHERE g.id=$1 AND m.user_id=$2 AND m.role IN ('owner','admin','moderator')`, [groupId, userId]);
    return result.rows[0] || null;
  }

  app.get("/api/groups/:groupId/requests", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    if (!groupId || !(await ownedGroup(groupId, req.user.id))) return res.status(404).json({ error: "Grupo não encontrado." });
    const result = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.avatar_url,r.created_at
      FROM group_join_requests r JOIN users u ON u.id=r.user_id
      WHERE r.group_id=$1 AND NOT ${blockedBetween("$2", "u.id")}
      ORDER BY r.created_at`, [groupId, req.user.id]);
    res.json({ requests: result.rows });
  });

  app.post("/api/groups/:groupId/requests/:userId", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    const userId = parseId(req.params.userId);
    const body = isRecord(req.body) ? req.body : {};
    if (!groupId || !userId || typeof body.approve !== "boolean") return res.status(400).json({ error: "Pedido inválido." });
    const group = await ownedGroup(groupId, req.user.id);
    if (!group) return res.status(404).json({ error: "Grupo não encontrado." });
    const handled = await transaction(async client => {
      const removed = await client.query(
        "DELETE FROM group_join_requests WHERE group_id=$1 AND user_id=$2 RETURNING user_id", [groupId, userId]);
      if (!removed.rowCount) return false;
      if (body.approve) {
        await client.query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [groupId, userId]);
        await client.query(`
          INSERT INTO notifications(user_id,actor_id,type,text)
          VALUES($1,$2,'group_join',$3)`, [userId, req.user.id, `Aceitou o teu pedido para entrar em «${group.name}».`]);
      }
      return true;
    });
    if (!handled) return res.status(404).json({ error: "Este pedido já não existe." });
    res.json({ approved: body.approve });
  });

  app.delete("/api/groups/:groupId", auth, async (req, res) => {
    const groupId = parseId(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: "Grupo inválido." });
    const media = await pool.query(
      "SELECT p.media_url FROM posts p JOIN social_groups g ON g.id=p.group_id WHERE g.id=$1 AND g.owner_id=$2",
      [groupId, req.user.id]);
    const result = await pool.query("DELETE FROM social_groups WHERE id=$1 AND owner_id=$2 RETURNING id", [groupId, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Grupo não encontrado." });
    await Promise.all(media.rows.map(row => removeUpload(row.media_url)));
    res.json({ deleted: true });
  });
}

module.exports = { registerGroupRoutes };
