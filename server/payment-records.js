// Pagamentos e recibos. Cada produto pago guarda o pagamento na sua própria tabela (promoções, Estrelas,
// campanhas, entradas em grupos); aqui juntam-se numa só lista, com o método usado (cartão, Multicaixa
// Express, Referência ou demonstração), para a equipa consultar e para cada pessoa ter os seus recibos.
// Os recibos são comprovativos de pagamento, não faturas com valor fiscal (essas exigem software certificado pela AGT).

const KINDS = {
  ad: { prefix: "P", label: "Promoção" },
  stars: { prefix: "E", label: "Estrelas" },
  campaign: { prefix: "C", label: "Campanha" },
  group_access: { prefix: "G", label: "Entrada em grupo" },
  course: { prefix: "K", label: "Curso" },
  subscription: { prefix: "S", label: "Subscrição" },
  event_ticket: { prefix: "B", label: "Bilhete" }
};
const METHODS = { card: "Cartão", express: "Multicaixa Express", reference: "Pagamento por Referência", paypal: "PayPal", redotpay: "RedotPay", paypay: "PayPay Africa", demo: "Demonstração (sem cobrança)" };
const STATUSES = { paid: "Pago", refunded: "Reembolsado", refund_due: "Reembolso por fazer" };

// Número do recibo: estável (vem do tipo, do ano do pagamento e do id), por isso o mesmo pagamento tem
// sempre o mesmo número, sem precisar de uma tabela de numeração. Ex.: BV-2026-E000012.
function receiptNumber(kind, id, paidAt) {
  const year = new Date(paidAt).getUTCFullYear();
  return `BV-${year}-${KINDS[kind].prefix}${String(id).padStart(6, "0")}`;
}

// Estado do pagamento a partir do reembolso: devolvido (ou demonstração), por devolver à mão, ou pago.
const refundState = alias => `CASE WHEN ${alias}.refund_status IN ('refunded','not_needed') THEN 'refunded'
           WHEN ${alias}.refund_status IN ('manual','failed') THEN 'refund_due' ELSE 'paid' END`;

// Todos os pagamentos confirmados, numa só forma. O pagamento local (Express/Referência) mais recente
// e confirmado diz o método; sem ele, um id da Stripe quer dizer cartão; sem nada, foi em demonstração.
const PAYMENTS_SQL = `
  WITH local AS (
    SELECT DISTINCT ON (purpose, ref_id) purpose, ref_id, method, provider_ref, entity, phone_last3
    FROM local_payments WHERE status='paid' ORDER BY purpose, ref_id, paid_at DESC
  ), items AS (
    SELECT 'ad'::text AS kind, a.id AS ref_id, a.owner_id AS user_id, a.budget::float AS amount_kz, a.paid_at,
      'Promoção «' || a.title || '» (' || a.days || ' dias)' AS description,
      COALESCE(a.stripe_payment_intent, a.stripe_session_id) AS card_ref,
      ${refundState("a")} AS status
    FROM ads a WHERE a.paid_at IS NOT NULL
    UNION ALL
    SELECT 'stars', s.id, s.user_id, s.amount_kz::float, s.paid_at, s.stars || ' Estrelas Tchilar',
      COALESCE(s.stripe_payment_intent, s.stripe_session_id), ${refundState("s")}
    FROM star_purchases s WHERE s.status='paid'
    UNION ALL
    SELECT 'campaign', c.id, c.brand_id, c.budget::float, c.paid_at, 'Campanha «' || c.title || '»',
      COALESCE(c.stripe_payment_intent, c.stripe_session_id), ${refundState("c")}
    FROM brand_campaigns c WHERE c.paid_at IS NOT NULL
    UNION ALL
    SELECT 'group_access', g.id, g.user_id, g.amount_kz::float, g.paid_at,
      'Entrada no grupo «' || COALESCE(sg.name, 'grupo apagado') || '»',
      COALESCE(g.stripe_payment_intent, g.stripe_session_id), ${refundState("g")}
    FROM group_access_purchases g LEFT JOIN social_groups sg ON sg.id=g.group_id WHERE g.status='paid'
    UNION ALL
    SELECT 'course', cp.id, cp.user_id, cp.amount_kz::float, cp.paid_at,
      'Curso «' || COALESCE(co.title, 'curso apagado') || '»',
      COALESCE(cp.stripe_payment_intent, cp.stripe_session_id), ${refundState("cp")}
    FROM course_purchases cp LEFT JOIN courses co ON co.id=cp.course_id WHERE cp.status='paid'
    UNION ALL
    SELECT 'subscription', sp.id, sp.subscriber_id, sp.amount_kz::float, sp.paid_at,
      'Subscrição de ' || COALESCE(cu.display_name, 'conta apagada') || ' (1 mês)',
      COALESCE(sp.stripe_payment_intent, sp.stripe_session_id), ${refundState("sp")}
    FROM subscription_payments sp LEFT JOIN users cu ON cu.id=sp.creator_id WHERE sp.status='paid'
    UNION ALL
    SELECT 'event_ticket', et.id::int, et.user_id, et.amount_kz::float, et.paid_at,
      'Bilhete «' || COALESCE(et.event_name, 'evento') || '»',
      COALESCE(et.stripe_payment_intent, et.stripe_session_id), ${refundState("et")}
    FROM event_tickets et WHERE et.status='paid' AND et.amount_kz > 0
  )
  SELECT i.kind, i.ref_id, i.user_id, i.amount_kz, i.paid_at, i.description, i.status, i.card_ref,
    COALESCE(l.method, CASE WHEN i.card_ref IS NOT NULL THEN 'card' ELSE 'demo' END) AS method,
    l.provider_ref, l.entity, l.phone_last3,
    u.username, u.display_name, u.email
  FROM items i
  LEFT JOIN local l ON l.purpose=i.kind AND l.ref_id=i.ref_id
  LEFT JOIN users u ON u.id=i.user_id`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

// Filtros da lista do administrador. Valores desconhecidos são ignorados em vez de darem erro,
// para um link antigo ou mal escrito continuar a abrir a lista.
function parsePaymentFilters(query = {}) {
  const filters = {};
  if (Object.hasOwn(KINDS, query.kind)) filters.kind = query.kind;
  if (Object.hasOwn(METHODS, query.method)) filters.method = query.method;
  if (Object.hasOwn(STATUSES, query.status)) filters.status = query.status;
  if (validDate(query.from)) filters.from = query.from;
  if (validDate(query.to)) filters.to = query.to;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  if (q) filters.q = q;
  const page = Number(query.page);
  filters.page = Number.isSafeInteger(page) && page > 0 && page <= 1000 ? page : 1;
  return filters;
}

// WHERE parametrizado. As datas contam no dia de Angola (Africa/Luanda), o "to" inclui o dia inteiro.
// A pesquisa aceita nome, @utilizador, email ou o número do recibo (BV-2026-E000012).
function paymentWhere(filters) {
  const params = [];
  const clauses = [];
  const add = value => { params.push(value); return `$${params.length}`; };
  if (filters.kind) clauses.push(`p.kind=${add(filters.kind)}`);
  if (filters.method) clauses.push(`p.method=${add(filters.method)}`);
  if (filters.status) clauses.push(`p.status=${add(filters.status)}`);
  if (filters.from) clauses.push(`(p.paid_at AT TIME ZONE 'Africa/Luanda')::date >= ${add(filters.from)}::date`);
  if (filters.to) clauses.push(`(p.paid_at AT TIME ZONE 'Africa/Luanda')::date <= ${add(filters.to)}::date`);
  if (filters.q) {
    const receipt = /^BV-\d{4}-([PECG])0*(\d{1,9})$/i.exec(filters.q);
    if (receipt) {
      const kind = Object.keys(KINDS).find(key => KINDS[key].prefix === receipt[1].toUpperCase());
      clauses.push(`(p.kind=${add(kind)} AND p.ref_id=${add(Number(receipt[2]))})`);
    } else {
      const like = add(`%${filters.q.replace(/[\\%_]/g, "\\$&").replace(/^@/, "")}%`);
      clauses.push(`(p.username ILIKE ${like} OR p.display_name ILIKE ${like} OR p.email ILIKE ${like} OR p.description ILIKE ${like} OR p.provider_ref ILIKE ${like})`);
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// O que cada pessoa vê do seu pagamento. A equipa vê também o email e as referências técnicas (Stripe).
function serializePayment(row, { admin = false } = {}) {
  const payment = {
    kind: row.kind,
    id: row.ref_id,
    receipt: receiptNumber(row.kind, row.ref_id, row.paid_at),
    kind_label: KINDS[row.kind].label,
    description: row.description,
    amount: row.amount_kz,
    paid_at: row.paid_at,
    method: row.method,
    method_label: METHODS[row.method],
    status: row.status,
    status_label: STATUSES[row.status],
    // Para Referência: entidade e referência usadas; para Express: os últimos 3 dígitos do telemóvel.
    entity: row.method === "reference" ? row.entity : null,
    reference: row.method === "reference" ? row.provider_ref : null,
    phone: row.method === "express" && row.phone_last3 ? `••• ••• ${row.phone_last3}` : null,
    customer: row.user_id ? { username: row.username, display_name: row.display_name } : null
  };
  if (admin) {
    payment.customer = row.user_id ? { ...payment.customer, email: row.email } : null;
    payment.provider_ref = row.method === "card" ? row.card_ref : row.provider_ref;
  }
  return payment;
}

// CSV para a contabilidade. Aspas em todos os campos; valores que começam por = + - @ levam um apóstrofo
// à frente, para o Excel não os executar como fórmulas (injeção de CSV).
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}
const luandaDate = value => new Date(value).toLocaleString("sv-SE", { timeZone: "Africa/Luanda" }).slice(0, 16);
function paymentsCsv(rows) {
  const header = ["Recibo", "Data (Luanda)", "Tipo", "Descrição", "Método", "Valor (Kz)", "Estado", "Utilizador", "Email", "Referência"];
  const lines = rows.map(row => {
    const payment = serializePayment(row, { admin: true });
    return [payment.receipt, luandaDate(payment.paid_at), payment.kind_label, payment.description, payment.method_label,
      payment.amount.toFixed(2), payment.status_label, payment.customer?.username || "", payment.customer?.email || "",
      payment.provider_ref || ""].map(csvCell).join(";");
  });
  // BOM para o Excel abrir os acentos certos; ";" porque o Excel em português usa a vírgula nas casas decimais.
  return `\uFEFF${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`;
}

// Quem emite o recibo. Os dados legais vêm do ambiente, para não ficarem escritos no código.
function issuer() {
  return {
    name: process.env.COMPANY_NAME || "Alves Estúdio",
    nif: process.env.COMPANY_NIF || "5001541781",
    address: process.env.COMPANY_ADDRESS || null,
    email: process.env.COMPANY_EMAIL || null
  };
}

const PAGE_SIZE = 50;

function registerPaymentRoutes(app, { pool, auth, requireAdmin, parseId }) {
  const findOne = (kind, id) => pool.query(`SELECT * FROM (${PAYMENTS_SQL}) p WHERE p.kind=$1 AND p.ref_id=$2`, [kind, id]);
  const parseTarget = params => ({ kind: Object.hasOwn(KINDS, params.kind) ? params.kind : null, id: parseId(params.id) });

  // Os pagamentos da própria pessoa (Definições → Pagamentos e recibos).
  app.get("/api/payments", auth, async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM (${PAYMENTS_SQL}) p WHERE p.user_id=$1 ORDER BY p.paid_at DESC LIMIT 200`, [req.user.id]);
    res.json({ payments: result.rows.map(row => serializePayment(row)) });
  });

  // Um recibo. Só a pessoa que pagou o vê aqui; a equipa usa a rota de administração (com 2FA).
  app.get("/api/payments/:kind/:id/receipt", auth, async (req, res) => {
    const { kind, id } = parseTarget(req.params);
    if (!kind || !id) return res.status(400).json({ error: "Recibo inválido." });
    const row = (await findOne(kind, id)).rows[0];
    if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: "Recibo não encontrado." });
    res.json({ payment: serializePayment(row), issuer: issuer() });
  });

  app.get("/api/admin/payments", auth, requireAdmin, async (req, res) => {
    const filters = parsePaymentFilters(req.query);
    const { where, params } = paymentWhere(filters);
    const base = `FROM (${PAYMENTS_SQL}) p ${where}`;
    const [list, totals] = await Promise.all([
      pool.query(`SELECT p.* ${base} ORDER BY p.paid_at DESC, p.kind, p.ref_id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(filters.page - 1) * PAGE_SIZE}`, params),
      pool.query(`SELECT COUNT(*)::int AS count,
          COALESCE(SUM(p.amount_kz) FILTER (WHERE p.status='paid'),0)::float AS received,
          COALESCE(SUM(p.amount_kz) FILTER (WHERE p.status='refunded'),0)::float AS refunded,
          COALESCE(SUM(p.amount_kz) FILTER (WHERE p.status='refund_due'),0)::float AS refund_due
        ${base}`, params)
    ]);
    res.json({
      payments: list.rows.map(row => serializePayment(row, { admin: true })),
      totals: totals.rows[0],
      page: filters.page,
      pages: Math.max(1, Math.ceil(totals.rows[0].count / PAGE_SIZE))
    });
  });

  // Exportação para a contabilidade, com os mesmos filtros da lista (até 10 000 linhas).
  app.get("/api/admin/payments.csv", auth, requireAdmin, async (req, res) => {
    const filters = parsePaymentFilters(req.query);
    const { where, params } = paymentWhere(filters);
    const result = await pool.query(`SELECT p.* FROM (${PAYMENTS_SQL}) p ${where} ORDER BY p.paid_at ASC LIMIT 10000`, params);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tchilar-pagamentos-${stamp}.csv"`);
    res.send(paymentsCsv(result.rows));
  });

  app.get("/api/admin/payments/:kind/:id", auth, requireAdmin, async (req, res) => {
    const { kind, id } = parseTarget(req.params);
    if (!kind || !id) return res.status(400).json({ error: "Pagamento inválido." });
    const row = (await findOne(kind, id)).rows[0];
    if (!row) return res.status(404).json({ error: "Pagamento não encontrado." });
    res.json({ payment: serializePayment(row, { admin: true }), issuer: issuer() });
  });
}

module.exports = {
  KINDS, METHODS, STATUSES, PAYMENTS_SQL, csvCell, issuer, parsePaymentFilters, paymentWhere, paymentsCsv, receiptNumber,
  registerPaymentRoutes, serializePayment
};
