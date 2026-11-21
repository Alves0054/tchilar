// Painel de administração: números do dia a dia, gestão de pessoas, reembolsos feitos à mão e o
// registo de tudo o que a equipa faz. Todas as rotas exigem admin com verificação em dois passos.
const { PAYMENTS_SQL, serializePayment } = require("./payment-records");
const { normalizePromotionCode } = require("./promotion-codes");

// O que aparece no registo. A chave é o que fica guardado na base de dados.
const ACTION_LABELS = {
  promotion_code_create: "Criou um código promocional",
  promotion_code_toggle: "Ativou ou desativou um código promocional",
  ad_approve: "Aprovou a promoção",
  ad_reject: "Recusou a promoção",
  refund_done: "Confirmou o reembolso",
  payout_paid: "Pagou o levantamento",
  payout_reject: "Recusou o levantamento",
  user_suspend: "Suspendeu a conta",
  user_unsuspend: "Reativou a conta",
  user_verify_email: "Confirmou o email",
  report_dismiss: "Arquivou a denúncia",
  report_hide_post: "Escondeu a publicação",
  report_restore_post: "Repôs a publicação",
  report_delete_comment: "Apagou o comentário",
  report_suspend_user: "Suspendeu a conta (denúncia)",
  report_unsuspend_user: "Reativou a conta (denúncia)",
  refund_start: "Reembolsou o pagamento",
  payment_confirm: "Confirmou à mão o pagamento",
  payout_export: "Exportou os levantamentos para o banco",
  role_change: "Mudou a função na equipa",
  data_export: "Exportou os dados pessoais",
  data_close: "Respondeu ao pedido de dados",
  data_delete: "Apagou a conta a pedido",
  content_hide: "Escondeu",
  content_restore: "Voltou a mostrar",
  content_delete: "Apagou",
  broadcast: "Enviou um aviso geral"
};

// Guarda uma ação da equipa. Recebe o client da transação quando existe, para a ação e o registo
// ficarem gravados juntos (ou nenhum dos dois).
async function logAdminAction(db, adminId, action, targetType, targetId, note = "") {
  await db.query("INSERT INTO admin_actions(admin_id,action,target_type,target_id,note) VALUES($1,$2,$3,$4,$5)",
    [adminId, action, targetType, targetId ?? null, String(note || "").slice(0, 300)]);
}

const USER_FILTERS = {
  all: "TRUE",
  suspended: "u.suspended_at IS NOT NULL",
  admins: "u.is_admin",
  creators: "u.is_creator",
  unverified: "NOT u.email_verified",
  online: "u.last_seen_at > NOW() - INTERVAL '5 minutes'"
};
const PAGE_SIZE = 30;
const pageOf = value => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 1000 ? page : 1;
};
const likeOf = text => `%${text.replace(/[\\%_]/g, "\\$&").replace(/^@/, "")}%`;

const serializeAction = row => ({
  id: row.id, action: row.action, label: ACTION_LABELS[row.action] || row.action, target_type: row.target_type,
  target_id: row.target_id, note: row.note, created_at: row.created_at,
  admin: row.admin_username ? { username: row.admin_username, display_name: row.admin_display_name } : null,
  target_user: row.target_username ? { id: row.target_id, username: row.target_username, display_name: row.target_display_name } : null
});
const ACTIONS_SQL = `
  SELECT a.*, ad.username AS admin_username, ad.display_name AS admin_display_name,
    tu.username AS target_username, tu.display_name AS target_display_name
  FROM admin_actions a
  LEFT JOIN users ad ON ad.id=a.admin_id
  LEFT JOIN users tu ON a.target_type='user' AND tu.id=a.target_id`;

function registerAdminRoutes(app, { pool, auth, requireAdmin, requireRole, parseId, cleanText, transaction }) {
  const moderation = requireRole("moderation");
  const finance = requireRole("finance");
  const superOnly = requireRole("super");
  // -------------------------------------------------------------------------------------------
  // Painel: números e o que está à espera da equipa
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/overview", auth, requireAdmin, async (_req, res) => {
    const [people, money, daily, todo, recent] = await Promise.all([
      pool.query(`SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_7d,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS new_30d,
          COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '5 minutes')::int AS online,
          COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '1 day')::int AS active_1d,
          COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '7 days')::int AS active_7d,
          COUNT(*) FILTER (WHERE is_creator)::int AS creators,
          COUNT(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended,
          COUNT(*) FILTER (WHERE NOT email_verified)::int AS unverified
        FROM users`),
      pool.query(`SELECT
          COALESCE(SUM(amount_kz) FILTER (WHERE paid_at > NOW() - INTERVAL '30 days'),0)::float AS last_30d,
          COALESCE(SUM(amount_kz) FILTER (WHERE paid_at <= NOW() - INTERVAL '30 days' AND paid_at > NOW() - INTERVAL '60 days'),0)::float AS previous_30d,
          COUNT(*) FILTER (WHERE paid_at > NOW() - INTERVAL '30 days')::int AS count_30d,
          COALESCE(SUM(amount_kz) FILTER (WHERE (paid_at AT TIME ZONE 'Africa/Luanda')::date = (NOW() AT TIME ZONE 'Africa/Luanda')::date),0)::float AS today
        FROM (${PAYMENTS_SQL}) p WHERE p.status='paid'`),
      // Últimos 30 dias, dia a dia (hora de Angola), com zeros nos dias sem nada.
      pool.query(`
        WITH days AS (
          SELECT generate_series((NOW() AT TIME ZONE 'Africa/Luanda')::date - 29, (NOW() AT TIME ZONE 'Africa/Luanda')::date, INTERVAL '1 day')::date AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          COALESCE((SELECT SUM(p.amount_kz) FROM (${PAYMENTS_SQL}) p
            WHERE p.status='paid' AND (p.paid_at AT TIME ZONE 'Africa/Luanda')::date = d.day),0)::float AS revenue,
          (SELECT COUNT(*) FROM users u WHERE (u.created_at AT TIME ZONE 'Africa/Luanda')::date = d.day)::int AS signups
        FROM days d ORDER BY d.day`),
      pool.query(`SELECT
          (SELECT COUNT(*) FROM ads WHERE status='in_review')::int AS promotions_in_review,
          (SELECT COUNT(*) FROM pages WHERE business_requested_at IS NOT NULL AND business_verified_at IS NULL AND business_rejected_reason IS NULL AND hidden_at IS NULL)::int AS business_pending,
          (SELECT COUNT(*) FROM payout_requests WHERE status='requested')::int AS payouts_requested,
          (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE status='requested')::float AS payouts_amount,
          (SELECT COUNT(*) FROM reports WHERE status='open')::int AS open_reports,
          (SELECT COUNT(*) FROM (${PAYMENTS_SQL}) p WHERE p.status='refund_due')::int AS refunds_due,
          (SELECT COALESCE(SUM(p.amount_kz),0) FROM (${PAYMENTS_SQL}) p WHERE p.status='refund_due')::float AS refunds_amount,
          (SELECT COUNT(*) FROM data_requests WHERE status='open')::int AS data_requests_open,
          (SELECT COUNT(*) FROM data_requests WHERE status='open' AND created_at < NOW() - INTERVAL '20 days')::int AS data_requests_overdue,
          (SELECT COUNT(*) FROM local_payments WHERE status='pending' AND (expires_at IS NULL OR expires_at > NOW()))::int AS payments_waiting`),
      pool.query(`${ACTIONS_SQL} ORDER BY a.created_at DESC, a.id DESC LIMIT 6`)
    ]);
    res.json({ people: people.rows[0], money: money.rows[0], daily: daily.rows, todo: todo.rows[0], recent: recent.rows.map(serializeAction) });
  });

  // -------------------------------------------------------------------------------------------
  // Utilizadores
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/users", auth, requireAdmin, async (req, res) => {
    const filter = Object.hasOwn(USER_FILTERS, req.query.filter) ? req.query.filter : "all";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const page = pageOf(req.query.page);
    const params = [];
    let where = USER_FILTERS[filter];
    if (q) {
      params.push(likeOf(q));
      where += ` AND (u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1)`;
    }
    const [list, count] = await Promise.all([
      pool.query(`
        SELECT u.id,u.username,u.display_name,u.email,u.avatar_url,u.is_creator,u.is_admin,u.admin_role,u.email_verified,u.created_at,
          u.last_seen_at,u.suspended_at,u.province,u.partner_since IS NOT NULL AS is_partner,
          (SELECT COUNT(*) FROM reports r WHERE r.target_user_id=u.id AND r.status='open')::int AS open_reports
        FROM users u WHERE ${where}
        ORDER BY u.created_at DESC, u.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`, params)
    ]);
    res.json({ users: list.rows, total: count.rows[0].count, page, pages: Math.max(1, Math.ceil(count.rows[0].count / PAGE_SIZE)) });
  });

  // Ficha completa de uma pessoa: conta, atividade, dinheiro, denúncias e o que a equipa já fez.
  app.get("/api/admin/users/:id", auth, requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Conta inválida." });
    const user = await pool.query(`
      SELECT u.id,u.username,u.display_name,u.email,u.phone,u.avatar_url,u.bio,u.location,u.province,u.is_creator,u.is_admin,
        u.email_verified,u.created_at,u.last_seen_at,u.suspended_at,u.suspended_reason,u.partner_since,u.admin_role,
        u.totp_enabled_at IS NOT NULL AS two_factor,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id)::int AS posts,
        (SELECT COUNT(*) FROM follows f WHERE f.following_id=u.id)::int AS followers,
        (SELECT COUNT(*) FROM friendships f WHERE f.user_a_id=u.id OR f.user_b_id=u.id)::int AS friends,
        (SELECT COUNT(*) FROM reports r WHERE r.target_user_id=u.id)::int AS reports_total,
        (SELECT COUNT(*) FROM reports r WHERE r.target_user_id=u.id AND r.status='open')::int AS reports_open,
        (SELECT COUNT(*) FROM reports r WHERE r.reporter_id=u.id)::int AS reports_made,
        r.username AS referred_by
      FROM users u LEFT JOIN users r ON r.id=u.referred_by WHERE u.id=$1`, [id]);
    if (!user.rowCount) return res.status(404).json({ error: "Conta não encontrada." });
    // Dinheiro (pagamentos e levantamentos) só para quem trata das finanças; a moderação não o vê.
    const canSeeMoney = ["super", "finance"].includes(req.user.adminRole);
    const none = { rows: [] };
    const [payments, payouts, reports, actions] = await Promise.all([
      canSeeMoney ? pool.query(`SELECT * FROM (${PAYMENTS_SQL}) p WHERE p.user_id=$1 ORDER BY p.paid_at DESC LIMIT 20`, [id]) : none,
      canSeeMoney ? pool.query(`SELECT id,amount::float AS amount,status,method,bank_name,iban_last4,
          COALESCE(NULLIF(destination_hint,''),'•••• ' || iban_last4) AS destination,reference,note,created_at,processed_at
        FROM payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]) : none,
      pool.query(`SELECT id,target_type,reason,status,action,created_at FROM reports WHERE target_user_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      pool.query(`${ACTIONS_SQL} WHERE a.target_type='user' AND a.target_id=$1 ORDER BY a.created_at DESC LIMIT 20`, [id])
    ]);
    const paymentRows = payments.rows.map(row => serializePayment(row, { admin: true }));
    res.json({
      user: user.rows[0],
      money_hidden: !canSeeMoney,
      spent: canSeeMoney ? paymentRows.filter(item => item.status === "paid").reduce((sum, item) => sum + item.amount, 0) : null,
      payments: paymentRows,
      payouts: payouts.rows,
      reports: reports.rows,
      actions: actions.rows.map(serializeAction)
    });
  });

  // Suspender termina as sessões (auth_version+1). Contas de admin não se suspendem aqui:
  // primeiro retira-se o acesso de admin no servidor (npm run admin:grant -- email --revoke).
  app.post("/api/admin/users/:id/suspend", auth, moderation, async (req, res) => {
    const id = parseId(req.params.id);
    const reason = cleanText(req.body?.reason);
    if (!id) return res.status(400).json({ error: "Conta inválida." });
    if (id === req.user.id) return res.status(400).json({ error: "Não podes suspender a tua própria conta." });
    if (!reason || reason.length > 300) return res.status(400).json({ error: "Explica o motivo da suspensão (até 300 caracteres)." });
    const outcome = await transaction(async client => {
      const result = await client.query(`
        UPDATE users SET suspended_at=NOW(), suspended_reason=$2, auth_version=auth_version+1
        WHERE id=$1 AND suspended_at IS NULL AND is_admin=FALSE RETURNING id`, [id, reason]);
      if (!result.rowCount) return false;
      await logAdminAction(client, req.user.id, "user_suspend", "user", id, reason);
      return true;
    });
    if (!outcome) return res.status(409).json({ error: "Esta conta já está suspensa ou é de administração." });
    res.json({ suspended: true });
  });

  app.post("/api/admin/users/:id/unsuspend", auth, moderation, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Conta inválida." });
    const note = cleanText(req.body?.note) || "";
    const outcome = await transaction(async client => {
      const result = await client.query(
        "UPDATE users SET suspended_at=NULL, suspended_reason=NULL WHERE id=$1 AND suspended_at IS NOT NULL RETURNING id", [id]);
      if (!result.rowCount) return false;
      await logAdminAction(client, req.user.id, "user_unsuspend", "user", id, note);
      return true;
    });
    if (!outcome) return res.status(409).json({ error: "Esta conta não está suspensa." });
    res.json({ suspended: false });
  });

  // Para ajudar quem não recebe o email de confirmação (ex.: email de empresa com filtros).
  app.post("/api/admin/users/:id/verify-email", auth, moderation, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Conta inválida." });
    const outcome = await transaction(async client => {
      const result = await client.query("UPDATE users SET email_verified=TRUE WHERE id=$1 AND NOT email_verified RETURNING id", [id]);
      if (!result.rowCount) return false;
      await logAdminAction(client, req.user.id, "user_verify_email", "user", id);
      return true;
    });
    if (!outcome) return res.status(409).json({ error: "O email desta conta já está confirmado." });
    res.json({ email_verified: true });
  });

  // -------------------------------------------------------------------------------------------
  // Códigos promocionais
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/promotion-codes", auth, finance, async (_req, res) => {
    const result = await pool.query("SELECT * FROM promotion_codes ORDER BY created_at DESC, id DESC");
    res.json({ codes: result.rows });
  });

  app.post("/api/admin/promotion-codes", auth, finance, async (req, res) => {
    const code = normalizePromotionCode(req.body?.code);
    const discountPercent = Number(req.body?.discountPercent);
    const minAmount = Number(req.body?.minAmountKz || 0);
    const maxDiscount = req.body?.maxDiscountKz === "" || req.body?.maxDiscountKz == null ? null : Number(req.body.maxDiscountKz);
    const maxUses = req.body?.maxUses === "" || req.body?.maxUses == null ? null : Number(req.body.maxUses);
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const purposes = Array.isArray(req.body?.purposes) ? req.body.purposes.filter(value => typeof value === "string").slice(0, 20) : [];
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ error: "O código deve ter 3 a 40 letras, números, hífen ou underscore." });
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) return res.status(400).json({ error: "O desconto deve ser entre 1% e 100%." });
    if (!Number.isFinite(minAmount) || minAmount < 0) return res.status(400).json({ error: "O valor mínimo é inválido." });
    if (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount < 1)) return res.status(400).json({ error: "O desconto máximo é inválido." });
    if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) return res.status(400).json({ error: "O limite de usos é inválido." });
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "A data de validade é inválida." });
    try {
      const created = await pool.query(`
        INSERT INTO promotion_codes(code,discount_percent,min_amount_kz,max_discount_kz,max_uses,expires_at,applicable_purposes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [code, discountPercent, minAmount, maxDiscount, maxUses, expiresAt, purposes, req.user.id]);
      await logAdminAction(pool, req.user.id, "promotion_code_create", "promotion_code", created.rows[0].id, `Criou o código ${code}`);
      res.status(201).json({ code: created.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Já existe um código com esse nome." });
      throw error;
    }
  });

  app.patch("/api/admin/promotion-codes/:id", auth, finance, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Código inválido." });
    if (typeof req.body?.active !== "boolean") return res.status(400).json({ error: "Indica se o código está ativo." });
    const updated = await pool.query("UPDATE promotion_codes SET active=$2 WHERE id=$1 RETURNING *", [id, req.body.active]);
    if (!updated.rowCount) return res.status(404).json({ error: "Código não encontrado." });
    await logAdminAction(pool, req.user.id, "promotion_code_toggle", "promotion_code", id, req.body.active ? "Ativou o código" : "Desativou o código");
    res.json({ code: updated.rows[0] });
  });

  // -------------------------------------------------------------------------------------------
  // Registo de ações
  // -------------------------------------------------------------------------------------------
  app.get("/api/admin/actions", auth, superOnly, async (req, res) => {
    const page = pageOf(req.query.page);
    const action = Object.hasOwn(ACTION_LABELS, req.query.action) ? req.query.action : null;
    const params = action ? [action] : [];
    const where = action ? "WHERE a.action=$1" : "";
    const [list, count] = await Promise.all([
      pool.query(`${ACTIONS_SQL} ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM admin_actions a ${where}`, params)
    ]);
    res.json({
      actions: list.rows.map(serializeAction), labels: ACTION_LABELS,
      page, pages: Math.max(1, Math.ceil(count.rows[0].count / PAGE_SIZE))
    });
  });
}

module.exports = { ACTION_LABELS, logAdminAction, registerAdminRoutes };
