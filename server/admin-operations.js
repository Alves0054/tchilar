// Operações da equipa que mexem com dinheiro, dados pessoais e conteúdo:
// reembolsos de qualquer produto, pagamentos que ficaram a meio, pedidos sobre dados (Lei n.º 22/11),
// funções na equipa, moderação sem denúncia, avisos gerais e levantamentos em lote para o banco.
const { logAdminAction } = require("./admin-routes");
const { ANGOLA_PROVINCES } = require("./growth");
const { PAYMENTS_SQL, csvCell } = require("./payment-records");
const { PAYOUT_METHODS, decrypt } = require("./payouts");

const balanceSql = "SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'gift_received'),0)::int AS balance FROM star_ledger WHERE user_id=$1";
const notifyUser = (db, userId, text, type = "payment") =>
  userId ? db.query("INSERT INTO notifications(user_id,type,text) VALUES($1,$2,$3)", [userId, type, text]) : null;
const kz = value => `${Number(value).toLocaleString("pt-PT")} Kz`;

// Onde vive cada produto pago, para marcar o reembolso.
const REFUND_TABLES = { ad: "ads", stars: "star_purchases", campaign: "brand_campaigns", group_access: "group_access_purchases", course: "course_purchases", subscription: "subscription_payments" };

const PURPOSE_LABELS = { ad: "Promoção", stars: "Estrelas", campaign: "Campanha", group_access: "Entrada em grupo", course: "Curso", subscription: "Subscrição" };
const ATTEMPT_FILTERS = {
  pending: "lp.status='pending' AND (lp.expires_at IS NULL OR lp.expires_at > NOW())",
  expired: "(lp.status='expired' OR (lp.status='pending' AND lp.expires_at <= NOW()))",
  failed: "lp.status='failed'"
};
// Se o produto acabou por ser pago (por este ou por outro pagamento), já não há nada a resolver.
const PRODUCT_PAID_SQL = `CASE lp.purpose
  WHEN 'stars' THEN EXISTS(SELECT 1 FROM star_purchases x WHERE x.id=lp.ref_id AND x.status='paid')
  WHEN 'ad' THEN EXISTS(SELECT 1 FROM ads x WHERE x.id=lp.ref_id AND x.paid_at IS NOT NULL)
  WHEN 'campaign' THEN EXISTS(SELECT 1 FROM brand_campaigns x WHERE x.id=lp.ref_id AND x.paid_at IS NOT NULL)
  WHEN 'group_access' THEN EXISTS(SELECT 1 FROM group_access_purchases x WHERE x.id=lp.ref_id AND x.status='paid')
  WHEN 'course' THEN EXISTS(SELECT 1 FROM course_purchases x WHERE x.id=lp.ref_id AND x.status='paid')
  WHEN 'subscription' THEN EXISTS(SELECT 1 FROM subscription_payments x WHERE x.id=lp.ref_id AND x.status='paid')
  ELSE FALSE END`;

const DATA_REQUEST_KINDS = {
  export: "Cópia dos meus dados",
  correct: "Corrigir dados",
  delete: "Apagar a minha conta",
  other: "Outro assunto sobre os meus dados"
};
const ADMIN_ROLES = ["super", "finance", "moderation"];

// Público de um aviso. "province:Luanda" usa a lista oficial de províncias.
function parseAudience(value) {
  if (value === "all") return { sql: "TRUE", params: [], label: "Todas as pessoas" };
  if (value === "creators") return { sql: "u.is_creator", params: [], label: "Criadores" };
  if (value === "inactive") return { sql: "(u.last_seen_at IS NULL OR u.last_seen_at < NOW() - INTERVAL '30 days')", params: [], label: "Sem entrar há 30 dias" };
  if (typeof value === "string" && value.startsWith("province:")) {
    const province = value.slice("province:".length);
    if (ANGOLA_PROVINCES.includes(province)) return { sql: "u.province=$1", params: [province], label: `Província: ${province}` };
  }
  return null;
}

const CONTENT_TYPES = ["post", "comment", "group", "page"];

function registerAdminOperations(app, deps) {
  const { pool, auth, requireAdmin, requireRole, parseId, cleanText, isRecord, transaction, payments, payoutKey,
    buildUserExport, deleteAccount, sendPlainEmail } = deps;
  const finance = requireRole("finance");
  const moderation = requireRole("moderation");
  const superOnly = requireRole("super");
  const body = req => (isRecord(req.body) ? req.body : {});

  // -------------------------------------------------------------------------------------------
  // Reembolsos
  // -------------------------------------------------------------------------------------------
  // 1) retira o que o pagamento deu (Estrelas, lugar no grupo, campanha, promoção no ar);
  // 2) devolve o dinheiro: cartão pela Stripe; Express e Referência ficam "por devolver" até a equipa
  //    transferir à mão e confirmar com POST .../refunded.
  app.post("/api/admin/payments/:kind/:id/refund", auth, finance, async (req, res) => {
    const kind = Object.hasOwn(REFUND_TABLES, req.params.kind) ? req.params.kind : null;
    const id = parseId(req.params.id);
    const note = cleanText(body(req).note);
    if (!kind || !id) return res.status(400).json({ error: "Pagamento inválido." });
    if (!note || note.length > 300) return res.status(400).json({ error: "Explica o motivo do reembolso (até 300 caracteres)." });
    const payment = (await pool.query(`SELECT * FROM (${PAYMENTS_SQL}) p WHERE p.kind=$1 AND p.ref_id=$2`, [kind, id])).rows[0];
    if (!payment) return res.status(404).json({ error: "Pagamento não encontrado." });
    if (payment.status !== "paid") return res.status(409).json({ error: "Este pagamento já foi (ou está a ser) reembolsado." });

    const outcome = await transaction(async client => {
      const table = REFUND_TABLES[kind];
      // FOR UPDATE: dois cliques ao mesmo tempo não reembolsam duas vezes.
      const row = (await client.query(`SELECT * FROM ${table} WHERE id=$1 AND refund_status IS NULL FOR UPDATE`, [id])).rows[0];
      if (!row) return { status: 409, error: "Este pagamento já foi (ou está a ser) reembolsado." };
      if (kind === "stars") {
        const { balance } = (await client.query(balanceSql, [row.user_id])).rows[0];
        if (balance < row.stars) {
          return { status: 409, error: `A pessoa já usou parte destas Estrelas (tem ${balance} de ${row.stars}). Só se reembolsa enquanto ainda as tiver.` };
        }
        await client.query("INSERT INTO star_ledger(user_id,amount,kind) VALUES($1,$2,'refund')", [row.user_id, -row.stars]);
      }
      if (kind === "group_access" && row.group_id) {
        await client.query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2 AND user_id<>COALESCE($3,0)", [row.group_id, row.user_id, row.owner_id]);
      }
      if (kind === "campaign") {
        if (row.status === "completed") return { status: 409, error: "Esta campanha já foi concluída e o criador já recebeu. Resolve com as duas partes antes de devolver." };
        await client.query("UPDATE brand_campaigns SET status='cancelled' WHERE id=$1", [id]);
        await notifyUser(client, row.creator_id, `A campanha «${row.title}» foi cancelada e o valor devolvido à marca.`, "campaign");
      }
      // Mês de subscrição devolvido: o acesso acaba já e não volta a pedir renovação.
      if (kind === "subscription" && row.subscriber_id && row.creator_id) {
        await client.query(`UPDATE subscriptions SET current_period_end=LEAST(current_period_end, NOW()), cancel_at_period_end=TRUE, updated_at=NOW()
          WHERE subscriber_id=$1 AND creator_id=$2 AND provider<>'stripe'`, [row.subscriber_id, row.creator_id]);
      }
      if (kind === "ad" && ["in_review", "active", "paused"].includes(row.status)) {
        await client.query("UPDATE ads SET status='ended', ends_at=LEAST(ends_at, NOW()) WHERE id=$1", [id]);
      }
      // Provisório: o acesso já saiu; o estado final do dinheiro escreve-se a seguir.
      await client.query(`UPDATE ${table} SET refund_status='manual' WHERE id=$1`, [id]);
      await logAdminAction(client, req.user.id, "refund_start", kind, id, note);
      return { ok: true };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });

    // A Stripe só aceita reembolsar um payment intent (pi_...); um id de sessão fica para devolver à mão.
    const intent = payment.method === "card" && /^pi_/.test(payment.card_ref || "") ? payment.card_ref : null;
    const refund = await payments.refund({ paymentIntent: intent, demo: payment.method === "demo" });
    const done = ["refunded", "not_needed"].includes(refund.status);
    await pool.query(`UPDATE ${REFUND_TABLES[kind]} SET refund_status=$2, refunded_at=${done ? "NOW()" : "NULL"} WHERE id=$1`, [id, refund.status]);
    await notifyUser(pool, payment.user_id, done
      ? `Reembolsámos ${kz(payment.amount_kz)} (${payment.description}).`
      : `Vamos devolver-te ${kz(payment.amount_kz)} (${payment.description}). A equipa trata da transferência.`);
    res.json({ refund: refund.status, status: done ? "refunded" : "refund_due" });
  });

  // A equipa já devolveu o dinheiro à mão (Express/Referência ou falha da Stripe): fica registado.
  app.post("/api/admin/payments/:kind/:id/refunded", auth, finance, async (req, res) => {
    const kind = Object.hasOwn(REFUND_TABLES, req.params.kind) ? req.params.kind : null;
    const id = parseId(req.params.id);
    const note = cleanText(body(req).note);
    if (!kind || !id) return res.status(400).json({ error: "Pagamento inválido." });
    if (!note || note.length > 300) return res.status(400).json({ error: "Indica como foi devolvido (ex.: referência da transferência)." });
    const payment = (await pool.query(`SELECT * FROM (${PAYMENTS_SQL}) p WHERE p.kind=$1 AND p.ref_id=$2`, [kind, id])).rows[0];
    const outcome = await transaction(async client => {
      const result = await client.query(`
        UPDATE ${REFUND_TABLES[kind]} SET refund_status='refunded', refunded_at=NOW()
        WHERE id=$1 AND refund_status IN ('manual','failed') RETURNING id`, [id]);
      if (!result.rowCount) return false;
      await logAdminAction(client, req.user.id, "refund_done", kind, id, note);
      await notifyUser(client, payment?.user_id, `Devolvemos ${kz(payment.amount_kz)} (${payment.description}).`, kind === "ad" ? "ad" : "payment");
      return true;
    });
    if (!outcome) return res.status(409).json({ error: "Este pagamento não tem um reembolso por fazer." });
    res.json({ status: "refunded" });
  });

  // -------------------------------------------------------------------------------------------
  // Pagamentos que ficaram a meio (Express e Referência pendentes, expirados ou falhados)
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/payment-attempts", auth, finance, async (req, res) => {
    const status = Object.hasOwn(ATTEMPT_FILTERS, req.query.status) ? req.query.status : "pending";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const params = [];
    let where = ATTEMPT_FILTERS[status];
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, "\\$&").replace(/^@/, "")}%`);
      where += " AND (u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1 OR lp.provider_ref ILIKE $1)";
    }
    const result = await pool.query(`
      SELECT lp.id,lp.purpose,lp.ref_id,lp.method,lp.amount_kz::float AS amount,lp.status,lp.provider_ref,lp.entity,lp.phone_last3,
        lp.expires_at,lp.created_at,lp.user_id,u.username,u.display_name,u.email,
        ${PRODUCT_PAID_SQL} AS product_paid
      FROM local_payments lp LEFT JOIN users u ON u.id=lp.user_id
      WHERE ${where} ORDER BY lp.created_at DESC LIMIT 100`, params);
    res.json({
      attempts: result.rows.map(row => ({
        ...row,
        purpose_label: PURPOSE_LABELS[row.purpose] || row.purpose,
        // O id provisório do Express (antes de a Paybyrd responder) não interessa à equipa.
        provider_ref: row.provider_ref?.startsWith("pending-") ? null : row.provider_ref
      }))
    });
  });

  // Pergunta outra vez ao fornecedor (Express: estado da transação; Referência: fila da ProxyPay).
  app.post("/api/admin/payment-attempts/:id/check", auth, finance, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Pagamento inválido." });
    const row = (await pool.query("SELECT id,user_id,method,status FROM local_payments WHERE id=$1", [id])).rows[0];
    if (!row) return res.status(404).json({ error: "Pagamento não encontrado." });
    try {
      if (row.method === "reference" && payments.pollProxyPay) await payments.pollProxyPay();
      else if (row.user_id) await payments.status(row.id, row.user_id);
    } catch (error) {
      console.error("Verificação do pagamento:", error.message);
      return res.status(502).json({ error: "O fornecedor não respondeu. Tenta daqui a pouco." });
    }
    const fresh = (await pool.query("SELECT status FROM local_payments WHERE id=$1", [id])).rows[0];
    res.json({ status: fresh.status });
  });

  // Confirmar à mão: só com prova (comprovativo do banco) e só se o produto ainda não foi pago de outra forma.
  app.post("/api/admin/payment-attempts/:id/confirm", auth, finance, async (req, res) => {
    const id = parseId(req.params.id);
    const note = cleanText(body(req).note);
    if (!id) return res.status(400).json({ error: "Pagamento inválido." });
    if (!note || note.length > 300) return res.status(400).json({ error: "Indica a prova do pagamento (ex.: nº do comprovativo do banco)." });
    const row = (await pool.query(`SELECT lp.*, ${PRODUCT_PAID_SQL} AS product_paid FROM local_payments lp WHERE lp.id=$1`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: "Pagamento não encontrado." });
    if (row.status === "paid" || row.product_paid) return res.status(409).json({ error: "Este produto já está pago. Não confirmes outra vez." });
    if (!(await payments.confirmManually(id))) return res.status(409).json({ error: "Este pagamento já foi confirmado." });
    await logAdminAction(pool, req.user.id, "payment_confirm", "local_payment", id, note);
    await notifyUser(pool, row.user_id, `Confirmámos o teu pagamento de ${kz(row.amount_kz)}. Obrigado!`);
    res.json({ status: "paid" });
  });

  // -------------------------------------------------------------------------------------------
  // Pedidos sobre dados pessoais
  // -------------------------------------------------------------------------------------------
  app.get("/api/data-requests", auth, async (req, res) => {
    const result = await pool.query(
      "SELECT id,kind,details,status,answer,created_at,handled_at FROM data_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [req.user.id]);
    res.json({ requests: result.rows, kinds: DATA_REQUEST_KINDS });
  });

  app.post("/api/data-requests", auth, async (req, res) => {
    const { kind } = body(req);
    const details = cleanText(body(req).details) || "";
    if (!Object.hasOwn(DATA_REQUEST_KINDS, kind)) return res.status(400).json({ error: "Escolhe o tipo de pedido." });
    if (details.length > 1000) return res.status(400).json({ error: "Explica em até 1000 caracteres." });
    if (["correct", "other"].includes(kind) && !details) return res.status(400).json({ error: "Explica o que precisas." });
    const user = (await pool.query("SELECT username,email FROM users WHERE id=$1", [req.user.id])).rows[0];
    try {
      const created = await pool.query(
        "INSERT INTO data_requests(user_id,username,email,kind,details) VALUES($1,$2,$3,$4,$5) RETURNING id,kind,details,status,created_at",
        [req.user.id, user.username, user.email, kind, details]);
      res.status(201).json({ request: created.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Já tens um pedido destes em análise." });
      throw error;
    }
  });

  app.get("/api/admin/data-requests", auth, superOnly, async (req, res) => {
    const status = ["open", "done", "rejected"].includes(req.query.status) ? req.query.status : "open";
    const result = await pool.query(`
      SELECT r.*, h.username AS handled_by_username,
        (r.created_at < NOW() - INTERVAL '20 days') AS overdue
      FROM data_requests r LEFT JOIN users h ON h.id=r.handled_by
      WHERE r.status=$1 ORDER BY r.created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 100`, [status]);
    res.json({ requests: result.rows, kinds: DATA_REQUEST_KINDS });
  });

  const openRequest = async id => (await pool.query("SELECT * FROM data_requests WHERE id=$1 AND status='open'", [id])).rows[0];

  app.get("/api/admin/data-requests/:id/export", auth, superOnly, async (req, res) => {
    const id = parseId(req.params.id);
    const request = id && await openRequest(id);
    if (!request?.user_id) return res.status(404).json({ error: "Pedido não encontrado ou a conta já não existe." });
    const data = await buildUserExport(request.user_id);
    await logAdminAction(pool, req.user.id, "data_export", "user", request.user_id, `Pedido #${id}`);
    res.set("Content-Disposition", `attachment; filename="tchilar-dados-${request.username}-pedido-${id}.json"`);
    res.json(data);
  });

  app.post("/api/admin/data-requests/:id/close", auth, superOnly, async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = body(req);
    const answer = cleanText(body(req).answer);
    if (!id || !["done", "rejected"].includes(status)) return res.status(400).json({ error: "Pedido inválido." });
    if (!answer || answer.length > 1000) return res.status(400).json({ error: "Escreve a resposta para a pessoa (até 1000 caracteres)." });
    const result = await pool.query(`
      UPDATE data_requests SET status=$2, answer=$3, handled_by=$4, handled_at=NOW()
      WHERE id=$1 AND status='open' RETURNING user_id,kind`, [id, status, answer, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Este pedido já foi tratado." });
    await logAdminAction(pool, req.user.id, "data_close", "data_request", id, answer);
    await notifyUser(pool, result.rows[0].user_id, `O teu pedido «${DATA_REQUEST_KINDS[result.rows[0].kind]}» foi ${status === "done" ? "tratado" : "recusado"}: ${answer}`, "privacy");
    res.json({ status });
  });

  // Apagar a conta a pedido: escreve-se o @ da pessoa para confirmar. Não se apagam contas da equipa.
  app.post("/api/admin/data-requests/:id/delete-account", auth, superOnly, async (req, res) => {
    const id = parseId(req.params.id);
    const request = id && await openRequest(id);
    if (!request || request.kind !== "delete" || !request.user_id) return res.status(404).json({ error: "Pedido de apagamento não encontrado." });
    if (body(req).confirm !== request.username) return res.status(400).json({ error: `Escreve ${request.username} para confirmar.` });
    const profile = (await pool.query("SELECT is_admin,avatar_url,cover_url FROM users WHERE id=$1", [request.user_id])).rows[0];
    if (!profile) return res.status(404).json({ error: "A conta já não existe." });
    if (profile.is_admin) return res.status(409).json({ error: "Retira primeiro o acesso de equipa a esta conta." });
    const outcome = await deleteAccount(request.user_id, profile);
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    await pool.query("UPDATE data_requests SET status='done', answer='Conta e dados apagados.', handled_by=$2, handled_at=NOW() WHERE id=$1", [id, req.user.id]);
    await logAdminAction(pool, req.user.id, "data_delete", "data_request", id, `@${request.username}`);
    res.json({ deleted: true });
  });

  // -------------------------------------------------------------------------------------------
  // Funções na equipa
  // -------------------------------------------------------------------------------------------
  // role null retira o acesso de equipa. Ninguém muda a própria função (evita ficar sem nenhum super por engano).
  app.post("/api/admin/users/:id/role", auth, superOnly, async (req, res) => {
    const id = parseId(req.params.id);
    const { role } = body(req);
    if (!id) return res.status(400).json({ error: "Conta inválida." });
    if (role !== null && !ADMIN_ROLES.includes(role)) return res.status(400).json({ error: "Função inválida." });
    if (id === req.user.id) return res.status(400).json({ error: "Não podes mudar a tua própria função." });
    const result = await transaction(async client => {
      const updated = await client.query(`
        UPDATE users SET is_admin=$2, admin_role=$3, auth_version=auth_version + CASE WHEN $2 THEN 0 ELSE 1 END
        WHERE id=$1 AND suspended_at IS NULL AND email_verified RETURNING username`, [id, role !== null, role]);
      if (!updated.rowCount) return null;
      await logAdminAction(client, req.user.id, "role_change", "user", id, role || "sem acesso");
      return updated.rows[0];
    });
    if (!result) return res.status(409).json({ error: "Só contas ativas e com email confirmado podem entrar na equipa." });
    res.json({ role });
  });

  // -------------------------------------------------------------------------------------------
  // Moderação sem denúncia
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/content", auth, moderation, async (req, res) => {
    const type = CONTENT_TYPES.includes(req.query.type) ? req.query.type : "post";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const onlyHidden = req.query.hidden === "1" && type !== "comment";
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const queries = {
      post: `SELECT p.id, LEFT(p.body,400) AS text, p.media_url, p.media_type, p.hidden_at, p.hidden_reason, p.created_at, p.group_id, p.page_id,
          u.id AS owner_id, u.username, u.display_name,
          (SELECT COUNT(*) FROM reports r WHERE r.target_type='post' AND r.target_id=p.id AND r.status='open')::int AS open_reports
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE ($1='' OR p.body ILIKE $2 OR u.username ILIKE $2) ${onlyHidden ? "AND p.hidden_at IS NOT NULL" : ""}
        ORDER BY p.created_at DESC LIMIT 50`,
      comment: `SELECT c.id, LEFT(c.body,400) AS text, c.post_id, c.created_at, NULL::timestamptz AS hidden_at,
          u.id AS owner_id, u.username, u.display_name,
          (SELECT COUNT(*) FROM reports r WHERE r.target_type='comment' AND r.target_id=c.id AND r.status='open')::int AS open_reports
        FROM comments c JOIN users u ON u.id=c.user_id
        WHERE ($1='' OR c.body ILIKE $2 OR u.username ILIKE $2)
        ORDER BY c.created_at DESC LIMIT 50`,
      group: `SELECT g.id, g.name AS title, LEFT(g.description,300) AS text, g.is_secret, g.requires_approval, g.hidden_at, g.created_at,
          u.id AS owner_id, u.username, u.display_name,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS members
        FROM social_groups g JOIN users u ON u.id=g.owner_id
        WHERE ($1='' OR g.name ILIKE $2 OR g.description ILIKE $2 OR u.username ILIKE $2) ${onlyHidden ? "AND g.hidden_at IS NOT NULL" : ""}
        ORDER BY g.created_at DESC LIMIT 50`,
      page: `SELECT p.id, p.name AS title, LEFT(p.description,300) AS text, p.page_type, p.category, p.subcategory, p.hidden_at, p.created_at,
          u.id AS owner_id, u.username, u.display_name,
          (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS followers
        FROM pages p LEFT JOIN users u ON u.id=p.owner_id
        WHERE ($1='' OR p.name ILIKE $2 OR p.description ILIKE $2 OR u.username ILIKE $2) ${onlyHidden ? "AND p.hidden_at IS NOT NULL" : ""}
        ORDER BY p.created_at DESC LIMIT 50`
    };
    const result = await pool.query(queries[type], [q, like]);
    res.json({ type, items: result.rows });
  });

  const CONTENT_SQL = {
    post: { hide: "UPDATE posts SET hidden_at=NOW(), hidden_reason='moderation' WHERE id=$1 AND hidden_at IS NULL RETURNING user_id AS owner_id",
      restore: "UPDATE posts SET hidden_at=NULL, hidden_reason=NULL WHERE id=$1 AND hidden_at IS NOT NULL RETURNING user_id AS owner_id",
      label: "a tua publicação" },
    group: { hide: "UPDATE social_groups SET hidden_at=NOW() WHERE id=$1 AND hidden_at IS NULL RETURNING owner_id, name",
      restore: "UPDATE social_groups SET hidden_at=NULL WHERE id=$1 AND hidden_at IS NOT NULL RETURNING owner_id, name",
      label: "o teu grupo" },
    page: { hide: "UPDATE pages SET hidden_at=NOW() WHERE id=$1 AND hidden_at IS NULL RETURNING owner_id, name",
      restore: "UPDATE pages SET hidden_at=NULL WHERE id=$1 AND hidden_at IS NOT NULL RETURNING owner_id, name",
      label: "a tua página" },
    comment: { delete: "DELETE FROM comments WHERE id=$1 RETURNING user_id AS owner_id", label: "o teu comentário" }
  };

  // Esconder (publicações, grupos, páginas), repor, ou apagar (comentários). O dono é avisado com o motivo.
  app.post("/api/admin/content/:type/:id/:action", auth, moderation, async (req, res) => {
    const { type, action } = req.params;
    const id = parseId(req.params.id);
    const sql = CONTENT_SQL[type]?.[action];
    const reason = cleanText(body(req).reason);
    if (!id || !sql || !["hide", "restore", "delete"].includes(action)) return res.status(400).json({ error: "Ação inválida." });
    if (action !== "restore" && (!reason || reason.length > 300)) return res.status(400).json({ error: "Explica o motivo (o dono vai ver)." });
    const outcome = await transaction(async client => {
      const result = await client.query(sql, [id]);
      if (!result.rowCount) return null;
      const row = result.rows[0];
      await logAdminAction(client, req.user.id, `content_${action}`, type, id, reason || "");
      const name = row.name ? ` «${row.name}»` : "";
      const text = action === "restore"
        ? `A equipa do Tchilar voltou a mostrar ${CONTENT_SQL[type].label}${name}.`
        : `A equipa do Tchilar ${action === "delete" ? "apagou" : "escondeu"} ${CONTENT_SQL[type].label}${name}: ${reason}`;
      await notifyUser(client, row.owner_id, text, "moderation");
      return true;
    });
    if (!outcome) return res.status(409).json({ error: "Nada mudou: já estava assim ou já não existe." });
    res.json({ done: true });
  });

  // -------------------------------------------------------------------------------------------
  // Avisos gerais
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/broadcasts", auth, superOnly, async (_req, res) => {
    const result = await pool.query(`
      SELECT b.*, u.username AS admin_username FROM broadcasts b LEFT JOIN users u ON u.id=b.admin_id
      ORDER BY b.created_at DESC LIMIT 30`);
    res.json({ broadcasts: result.rows, provinces: ANGOLA_PROVINCES, emailEnabled: Boolean(process.env.SMTP_HOST) });
  });

  // Quantas pessoas recebem, antes de enviar.
  app.get("/api/admin/broadcasts/audience", auth, superOnly, async (req, res) => {
    const audience = parseAudience(req.query.audience);
    if (!audience) return res.status(400).json({ error: "Escolhe o público." });
    const result = await pool.query(`
      SELECT COUNT(*)::int AS people, COUNT(*) FILTER (WHERE u.email_verified)::int AS emails
      FROM users u WHERE u.suspended_at IS NULL AND ${audience.sql}`, audience.params);
    res.json({ ...result.rows[0], label: audience.label });
  });

  app.post("/api/admin/broadcasts", auth, superOnly, async (req, res) => {
    const data = body(req);
    const title = cleanText(data.title);
    const text = cleanText(data.body);
    const audience = parseAudience(data.audience);
    const channel = ["notification", "email", "both"].includes(data.channel) ? data.channel : null;
    if (!title || title.length > 120) return res.status(400).json({ error: "O título é obrigatório (até 120 caracteres)." });
    if (!text || text.length > 1000) return res.status(400).json({ error: "A mensagem é obrigatória (até 1000 caracteres)." });
    if (!audience || !channel) return res.status(400).json({ error: "Escolhe o público e o canal." });
    const where = `u.suspended_at IS NULL AND ${audience.sql}`;
    const created = await transaction(async client => {
      let recipients = 0;
      if (channel !== "email") {
        const inserted = await client.query(`
          INSERT INTO notifications(user_id,type,text)
          SELECT u.id,'announcement',${audience.params.length ? "$2" : "$1"} FROM users u WHERE ${where}`,
        audience.params.length ? [audience.params[0], `${title}: ${text}`] : [`${title}: ${text}`]);
        recipients = inserted.rowCount;
      } else {
        recipients = (await client.query(`SELECT COUNT(*)::int AS n FROM users u WHERE ${where} AND u.email_verified`, audience.params)).rows[0].n;
      }
      const row = await client.query(`
        INSERT INTO broadcasts(admin_id,title,body,audience,channel,recipients) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, title, text, audience.label, channel, recipients]);
      await logAdminAction(client, req.user.id, "broadcast", "broadcast", row.rows[0].id, `${title} · ${audience.label}`);
      return { id: row.rows[0].id, recipients };
    });
    // Os emails seguem em segundo plano, um a um (os fornecedores limitam envios por segundo).
    if (channel !== "notification" && process.env.SMTP_HOST) {
      const emails = (await pool.query(`SELECT u.email FROM users u WHERE ${where} AND u.email_verified`, audience.params)).rows;
      (async () => {
        let sent = 0;
        for (const { email } of emails) {
          try {
            if (await sendPlainEmail(email, `${title} — Tchilar`, `${text}\n\n— A equipa do Tchilar`)) sent += 1;
          } catch (error) {
            console.error("Aviso por email:", error.message);
          }
          await new Promise(resolve => setTimeout(resolve, 600));
        }
        await pool.query("UPDATE broadcasts SET emails_sent=$2 WHERE id=$1", [created.id, sent]);
      })().catch(error => console.error("Avisos por email:", error.message));
    }
    res.status(201).json(created);
  });

  // -------------------------------------------------------------------------------------------
  // Levantamentos em lote
  // -------------------------------------------------------------------------------------------
  // Ficheiro com todos os levantamentos por pagar, com o IBAN completo, para carregar no banco.
  app.get("/api/admin/payouts.csv", auth, finance, async (req, res) => {
    if (!payoutKey) return res.status(503).json({ error: "Falta configurar PAYOUT_ENCRYPTION_KEY no servidor." });
    const rows = (await pool.query(`
      SELECT r.id,r.amount::float AS amount,r.method,r.holder_name,r.bank_name,r.iban_encrypted,r.created_at,u.username
      FROM payout_requests r LEFT JOIN users u ON u.id=r.user_id
      WHERE r.status='requested' ORDER BY r.method, r.created_at ASC`)).rows;
    // Um ficheiro com todos os métodos: "Método" diz onde pagar e "Destino" é o IBAN, telemóvel, email ou ID RedotPay.
    const header = ["Pedido", "Método", "Beneficiário", "Banco / serviço", "Destino", "Valor (Kz)", "Descritivo", "Utilizador", "Pedido em"];
    const lines = rows.map(row => [row.id, PAYOUT_METHODS[row.method]?.label || row.method, row.holder_name, row.bank_name, decrypt(payoutKey, row.iban_encrypted), row.amount.toFixed(2),
      `Tchilar levantamento ${row.id}`, row.username || "", new Date(row.created_at).toISOString().slice(0, 10)].map(csvCell).join(";"));
    await logAdminAction(pool, req.user.id, "payout_export", "payout", null, `${rows.length} levantamentos`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tchilar-levantamentos-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`);
  });

  // Depois de o banco processar o lote: marca vários como pagos com a mesma referência.
  app.post("/api/admin/payouts/batch", auth, finance, async (req, res) => {
    const ids = Array.isArray(body(req).ids) ? [...new Set(body(req).ids.map(parseId))] : [];
    const reference = cleanText(body(req).reference);
    if (!ids.length || ids.length > 200 || ids.some(id => !id)) return res.status(400).json({ error: "Escolhe os levantamentos (até 200)." });
    if (!reference || reference.length > 120) return res.status(400).json({ error: "Indica a referência do lote no banco." });
    const paid = await transaction(async client => {
      const result = await client.query(`
        UPDATE payout_requests SET status='paid', reference=$2, processed_by=$3, processed_at=NOW()
        WHERE id = ANY($1::int[]) AND status='requested' RETURNING id,user_id,amount::float AS amount`, [ids, reference, req.user.id]);
      for (const row of result.rows) {
        await logAdminAction(client, req.user.id, "payout_paid", "payout", row.id, reference);
        await notifyUser(client, row.user_id, `O teu levantamento de ${kz(row.amount)} foi pago (ref.: ${reference}).`, "payout");
      }
      return result.rows.map(row => row.id);
    });
    res.json({ paid, skipped: ids.filter(id => !paid.includes(id)) });
  });

  // Contador para o Painel.
  app.get("/api/admin/operations/summary", auth, requireAdmin, async (_req, res) => {
    const result = await pool.query(`SELECT
      (SELECT COUNT(*) FROM data_requests WHERE status='open')::int AS data_requests_open,
      (SELECT COUNT(*) FROM data_requests WHERE status='open' AND created_at < NOW() - INTERVAL '20 days')::int AS data_requests_overdue,
      (SELECT COUNT(*) FROM local_payments lp WHERE ${ATTEMPT_FILTERS.expired} AND NOT ${PRODUCT_PAID_SQL}
        AND lp.created_at > NOW() - INTERVAL '30 days')::int AS attempts_unresolved`);
    res.json(result.rows[0]);
  });
}

module.exports = { ADMIN_ROLES, DATA_REQUEST_KINDS, parseAudience, registerAdminOperations };
