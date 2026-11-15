// Rotas de dinheiro: levantamentos dos criadores, revisão das promoções e área financeira
// do administrador. Registadas a partir de index.js.
const { logAdminAction } = require("./admin-routes");
const { campaignSplit, starsValueKz } = require("./growth");
const { groupAccessValueKz } = require("./groups");
const { courseShareKz } = require("./courses");
const { MIN_PAYOUT_KZ, partnerEarnings } = require("./promotions");
const {
  MIN_WITHDRAWAL_KZ, decrypt, encrypt, isValidAngolanIban, maskIban, normalizeIban, parseWithdrawal, payoutBalance
} = require("./payouts");

// Ganhos por fonte. As visualizações do Programa de Parceiros só contam em meses já fechados.
const EARNINGS_SQL = `
  SELECT u.partner_since,
    (SELECT COUNT(*) FROM post_views v JOIN posts p ON p.id=v.post_id
      WHERE p.user_id=u.id AND u.partner_since IS NOT NULL AND v.viewed_on >= u.partner_since::date
        AND v.viewed_on < date_trunc('month', CURRENT_DATE)::date)::int AS partner_views,
    (SELECT COUNT(*) FROM post_views v JOIN posts p ON p.id=v.post_id
      WHERE p.user_id=u.id AND u.partner_since IS NOT NULL AND v.viewed_on >= GREATEST(u.partner_since::date, date_trunc('month', CURRENT_DATE)::date))::int AS partner_views_this_month,
    (SELECT COALESCE(SUM(amount),0) FROM star_ledger WHERE user_id=u.id AND kind='gift_received')::int AS stars_received,
    (SELECT COALESCE(SUM(budget),0) FROM brand_campaigns WHERE creator_id=u.id AND status='completed')::float AS campaigns_gross,
    (SELECT COALESCE(SUM(amount_kz),0) FROM group_access_purchases WHERE owner_id=u.id AND status='paid' AND refund_status IS NULL)::float AS groups_gross,
    (SELECT COALESCE(SUM(cash_kz),0) FROM challenge_awards WHERE user_id=u.id)::float AS prizes_kz,
    (SELECT COALESCE(SUM(amount_kz),0) FROM course_purchases WHERE owner_id=u.id AND NOT by_team AND status='paid' AND refund_status IS NULL)::float AS courses_gross,
    (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE user_id=u.id AND status IN ('requested','paid'))::float AS withdrawn
  FROM users u WHERE u.id=$1`;

function earningsFrom(row) {
  const partnerKz = partnerEarnings(row.partner_views);
  const starsKz = starsValueKz(row.stars_received);
  const campaignsKz = campaignSplit(row.campaigns_gross).net;
  const groupsKz = groupAccessValueKz(row.groups_gross);
  const prizesKz = Math.round(Number(row.prizes_kz || 0) * 100) / 100;
  const coursesKz = courseShareKz(row.courses_gross);
  return {
    sources: { partnerKz, starsKz, campaignsKz, groupsKz, prizesKz, coursesKz },
    accruing: { partnerKz: partnerEarnings(row.partner_views_this_month) },
    withdrawn: row.withdrawn,
    ...payoutBalance({ partnerKz, starsKz, campaignsKz, groupsKz, prizesKz, coursesKz, withdrawnKz: row.withdrawn })
  };
}

const formatIban = iban => iban.replace(/(.{4})/g, "$1 ").trim();

function registerFinanceRoutes(app, deps) {
  const { pool, auth, requireRole, parseId, isRecord, cleanText, transaction, payments, payoutKey } = deps;
  // Promoções: revê quem trata do conteúdo ou do dinheiro; levantamentos e finanças só o dinheiro.
  const reviewAds = requireRole("moderation", "finance");
  const financeOnly = requireRole("finance");

  const notify = (db, userId, actorId, type, text) => db.query(
    "INSERT INTO notifications(user_id,actor_id,type,text) VALUES($1,$2,$3,$4)", [userId, actorId, type, text]);
  const needKey = res => res.status(503).json({ error: "Os levantamentos ainda não estão configurados (falta PAYOUT_ENCRYPTION_KEY)." });

  // ---------------------------------------------------------------------------------------------
  // Levantamentos (criador)
  // ---------------------------------------------------------------------------------------------
  app.get("/api/payouts", auth, async (req, res) => {
    const [earnings, account, requests] = await Promise.all([
      pool.query(EARNINGS_SQL, [req.user.id]),
      pool.query("SELECT holder_name,bank_name,iban_last4,updated_at FROM payout_accounts WHERE user_id=$1", [req.user.id]),
      pool.query(`SELECT id,amount::float AS amount,bank_name,iban_last4,status,reference,note,created_at,processed_at
        FROM payout_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id])
    ]);
    const acc = account.rows[0];
    res.json({
      ...earningsFrom(earnings.rows[0]),
      min_withdrawal: MIN_WITHDRAWAL_KZ,
      partner_min_payout: MIN_PAYOUT_KZ,
      account: acc ? { holder_name: acc.holder_name, bank_name: acc.bank_name, iban: maskIban(acc.iban_last4), updated_at: acc.updated_at } : null,
      requests: requests.rows.map(row => ({ ...row, iban: maskIban(row.iban_last4) })),
      configured: Boolean(payoutKey)
    });
  });

  app.put("/api/payouts/account", auth, async (req, res) => {
    if (!payoutKey) return needKey(res);
    const body = isRecord(req.body) ? req.body : {};
    const holderName = cleanText(body.holderName);
    const bankName = cleanText(body.bankName);
    const iban = normalizeIban(body.iban);
    if (!holderName || holderName.length > 120) return res.status(400).json({ error: "Indica o nome do titular da conta." });
    if (!bankName || bankName.length > 80) return res.status(400).json({ error: "Indica o banco." });
    if (!isValidAngolanIban(iban)) return res.status(400).json({ error: "O IBAN não é válido. Um IBAN angolano começa por AO e tem 25 caracteres." });
    await pool.query(`
      INSERT INTO payout_accounts(user_id,holder_name,bank_name,iban_encrypted,iban_last4,updated_at)
      VALUES($1,$2,$3,$4,$5,NOW())
      ON CONFLICT(user_id) DO UPDATE SET holder_name=EXCLUDED.holder_name, bank_name=EXCLUDED.bank_name,
        iban_encrypted=EXCLUDED.iban_encrypted, iban_last4=EXCLUDED.iban_last4, updated_at=NOW()`,
    [req.user.id, holderName, bankName, encrypt(payoutKey, iban), iban.slice(-4)]);
    res.json({ account: { holder_name: holderName, bank_name: bankName, iban: maskIban(iban.slice(-4)) } });
  });

  app.delete("/api/payouts/account", auth, async (req, res) => {
    await pool.query("DELETE FROM payout_accounts WHERE user_id=$1", [req.user.id]);
    res.json({ deleted: true });
  });

  app.post("/api/payouts/requests", auth, async (req, res) => {
    if (!payoutKey) return needKey(res);
    // Em demonstração as estrelas e campanhas não foram pagas a sério: não há dinheiro real para levantar.
    if (payments.mode !== "stripe") return res.status(409).json({ error: "Os levantamentos só estão disponíveis quando os pagamentos reais estão ativos." });
    const outcome = await transaction(async client => {
      // Um pedido de cada vez por pessoa: o saldo não pode ser levantado duas vezes.
      await client.query("SELECT pg_advisory_xact_lock(43, $1)", [req.user.id]);
      const account = (await client.query("SELECT * FROM payout_accounts WHERE user_id=$1", [req.user.id])).rows[0];
      if (!account) return { status: 409, error: "Adiciona primeiro a conta bancária onde queres receber." };
      const pending = await client.query("SELECT 1 FROM payout_requests WHERE user_id=$1 AND status='requested'", [req.user.id]);
      if (pending.rowCount) return { status: 409, error: "Já tens um levantamento em processamento." };
      const { available } = earningsFrom((await client.query(EARNINGS_SQL, [req.user.id])).rows[0]);
      const parsed = parseWithdrawal(req.body?.amount, available);
      if (parsed.error) return { status: 400, error: parsed.error };
      const request = await client.query(`
        INSERT INTO payout_requests(user_id,amount,holder_name,bank_name,iban_encrypted,iban_last4)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, parsed.amount, account.holder_name, account.bank_name, account.iban_encrypted, account.iban_last4]);
      return { id: request.rows[0].id };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.status(201).json(outcome);
  });

  // ---------------------------------------------------------------------------------------------
  // Revisão das promoções (administrador)
  // ---------------------------------------------------------------------------------------------
  app.get("/api/admin/ads", auth, reviewAds, async (req, res) => {
    const status = ["in_review", "active", "rejected", "all"].includes(req.query.status) ? req.query.status : "in_review";
    const result = await pool.query(`
      SELECT a.id,a.post_id,a.title,a.body,a.link_url,a.image_url,a.budget::float AS budget,a.days,a.status,a.paid_at,a.review_note,
        a.refund_status,a.target_provinces,a.target_min_age,a.target_max_age,a.created_at,
        u.username,u.display_name,u.avatar_url,
        LEFT(p.body,500) AS post_body,p.media_url AS post_media_url,p.media_type AS post_media_type
      FROM ads a JOIN users u ON u.id=a.owner_id LEFT JOIN posts p ON p.id=a.post_id
      WHERE ($1='all' AND a.status<>'pending_payment') OR a.status=$1
      ORDER BY a.paid_at ASC NULLS LAST, a.created_at ASC LIMIT 100`, [status]);
    res.json({ ads: result.rows });
  });

  app.post("/api/admin/ads/:id/approve", auth, reviewAds, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Promoção inválida." });
    // O prazo começa a contar quando é aprovada, não quando foi paga.
    const result = await pool.query(`
      UPDATE ads SET status='active', starts_at=NOW(), ends_at=NOW() + (days * INTERVAL '1 day'),
        reviewed_by=$2, reviewed_at=NOW(), review_note=''
      WHERE id=$1 AND status='in_review' RETURNING owner_id,title`, [id, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Esta promoção já não está em revisão." });
    await logAdminAction(pool, req.user.id, "ad_approve", "ad", id);
    await notify(pool, result.rows[0].owner_id, null, "ad", `A tua promoção «${result.rows[0].title}» foi aprovada e já está no ar.`);
    res.json({ status: "active" });
  });

  app.post("/api/admin/ads/:id/reject", auth, reviewAds, async (req, res) => {
    const id = parseId(req.params.id);
    const note = cleanText(req.body?.note);
    if (!id) return res.status(400).json({ error: "Promoção inválida." });
    if (!note || note.length > 300) return res.status(400).json({ error: "Explica o motivo da recusa (até 300 caracteres)." });
    const claimed = await pool.query(`
      UPDATE ads SET status='rejected', reviewed_by=$2, reviewed_at=NOW(), review_note=$3
      WHERE id=$1 AND status='in_review' RETURNING owner_id,title,stripe_payment_intent,budget::float AS budget`, [id, req.user.id, note]);
    if (!claimed.rowCount) return res.status(409).json({ error: "Esta promoção já não está em revisão." });
    const ad = claimed.rows[0];
    await logAdminAction(pool, req.user.id, "ad_reject", "ad", id, note);
    const refund = await payments.refund({ paymentIntent: ad.stripe_payment_intent });
    await pool.query("UPDATE ads SET refund_status=$2 WHERE id=$1", [id, refund.status]);
    const refundText = refund.status === "refunded" ? " O valor foi devolvido." : refund.status === "not_needed" ? "" : " A equipa vai devolver-te o valor pago.";
    await notify(pool, ad.owner_id, null, "ad", `A tua promoção «${ad.title}» não foi aprovada: ${note}.${refundText}`);
    res.json({ status: "rejected", refund: refund.status });
  });

  // ---------------------------------------------------------------------------------------------
  // Levantamentos (administrador)
  // ---------------------------------------------------------------------------------------------
  app.get("/api/admin/payouts", auth, financeOnly, async (req, res) => {
    if (!payoutKey) return needKey(res);
    const status = ["requested", "paid", "rejected"].includes(req.query.status) ? req.query.status : "requested";
    const result = await pool.query(`
      SELECT r.id,r.amount::float AS amount,r.holder_name,r.bank_name,r.iban_encrypted,r.iban_last4,r.status,r.reference,r.note,
        r.created_at,r.processed_at,u.username,u.display_name,u.avatar_url
      FROM payout_requests r LEFT JOIN users u ON u.id=r.user_id
      WHERE r.status=$1 ORDER BY r.created_at ASC LIMIT 200`, [status]);
    res.json({
      // O IBAN completo só é decifrado para os pedidos por pagar (é preciso para fazer a transferência).
      payouts: result.rows.map(({ iban_encrypted: sealed, ...row }) => ({
        ...row,
        iban: row.status === "requested" ? formatIban(decrypt(payoutKey, sealed)) : maskIban(row.iban_last4)
      }))
    });
  });

  app.post("/api/admin/payouts/:id/:action", auth, financeOnly, async (req, res) => {
    const id = parseId(req.params.id);
    const action = req.params.action;
    if (!id || !["paid", "reject"].includes(action)) return res.status(400).json({ error: "Pedido inválido." });
    const text = cleanText(action === "paid" ? req.body?.reference : req.body?.note);
    if (!text || text.length > (action === "paid" ? 120 : 300)) {
      return res.status(400).json({ error: action === "paid" ? "Indica a referência da transferência." : "Explica o motivo da recusa." });
    }
    const result = await pool.query(`
      UPDATE payout_requests SET status=$2, ${action === "paid" ? "reference" : "note"}=$3, processed_by=$4, processed_at=NOW()
      WHERE id=$1 AND status='requested' RETURNING user_id, amount::float AS amount`,
    [id, action === "paid" ? "paid" : "rejected", text, req.user.id]);
    if (!result.rowCount) return res.status(409).json({ error: "Este pedido já foi processado." });
    await logAdminAction(pool, req.user.id, action === "paid" ? "payout_paid" : "payout_reject", "payout", id, text);
    const row = result.rows[0];
    if (row.user_id) {
      await notify(pool, row.user_id, null, "payout", action === "paid"
        ? `O teu levantamento de ${row.amount.toLocaleString("pt-PT")} Kz foi pago (ref.: ${text}).`
        : `O teu levantamento de ${row.amount.toLocaleString("pt-PT")} Kz foi recusado: ${text}. O valor voltou ao teu saldo.`);
    }
    res.json({ status: action === "paid" ? "paid" : "rejected" });
  });

  // ---------------------------------------------------------------------------------------------
  // Resumo financeiro (administrador)
  // ---------------------------------------------------------------------------------------------
  app.get("/api/admin/finance", auth, financeOnly, async (req, res) => {
    const result = await pool.query(`
      SELECT
        -- Promoções pagas e não recusadas (as recusadas são devolvidas ou nunca foram cobradas).
        (SELECT COALESCE(SUM(budget),0) FROM ads WHERE paid_at IS NOT NULL AND status <> 'rejected' AND refund_status IS NULL)::float AS promotions_revenue,
        ((SELECT COALESCE(SUM(budget),0) FROM ads WHERE refund_status IN ('manual','failed'))
          + (SELECT COALESCE(SUM(amount_kz),0) FROM star_purchases WHERE refund_status IN ('manual','failed'))
          + (SELECT COALESCE(SUM(amount_kz),0) FROM group_access_purchases WHERE refund_status IN ('manual','failed'))
          + (SELECT COALESCE(SUM(budget),0) FROM brand_campaigns WHERE refund_status IN ('manual','failed')))::float AS refunds_to_do,
        (SELECT COUNT(*) FROM ads WHERE status='in_review')::int AS promotions_in_review,
        (SELECT COALESCE(SUM(amount_kz),0) FROM star_purchases WHERE status='paid' AND refund_status IS NULL)::float AS stars_sold,
        (SELECT COALESCE(SUM(amount),0) FROM star_ledger WHERE kind='gift_received')::int AS stars_gifted,
        (SELECT COALESCE(SUM(budget),0) FROM brand_campaigns WHERE status IN ('paid','completed'))::float AS campaigns_gross,
        (SELECT COALESCE(SUM(budget),0) FROM brand_campaigns WHERE status='completed')::float AS campaigns_completed,
        (SELECT COALESCE(SUM(amount_kz),0) FROM group_access_purchases WHERE status='paid' AND refund_status IS NULL)::float AS groups_sold,
        (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE status='requested')::float AS payouts_requested,
        (SELECT COUNT(*) FROM payout_requests WHERE status='requested')::int AS payouts_requested_count,
        (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE status='paid')::float AS payouts_paid,
        (SELECT COUNT(*) FROM post_views v JOIN posts p ON p.id=v.post_id JOIN users u ON u.id=p.user_id
          WHERE u.partner_since IS NOT NULL AND v.viewed_on >= u.partner_since::date
            AND v.viewed_on < date_trunc('month', CURRENT_DATE)::date)::int AS partner_views`);
    const row = result.rows[0];
    const campaignsCommission = campaignSplit(row.campaigns_gross).commission;
    const owedToCreators = starsValueKz(row.stars_gifted) + campaignSplit(row.campaigns_completed).net + partnerEarnings(row.partner_views)
      + groupAccessValueKz(row.groups_sold);
    res.json({
      income: { promotions: row.promotions_revenue, stars: row.stars_sold, campaigns: row.campaigns_gross, groups: row.groups_sold },
      tchilar_share: {
        promotions: row.promotions_revenue,
        stars: Math.round((row.stars_sold - starsValueKz(row.stars_gifted)) * 100) / 100,
        campaigns_commission: campaignsCommission,
        groups: Math.round((row.groups_sold - groupAccessValueKz(row.groups_sold)) * 100) / 100
      },
      creators: {
        earned: Math.round(owedToCreators * 100) / 100,
        requested: row.payouts_requested,
        requested_count: row.payouts_requested_count,
        paid: row.payouts_paid,
        still_owed: Math.round((owedToCreators - row.payouts_paid) * 100) / 100
      },
      promotions_in_review: row.promotions_in_review,
      refunds_to_do: row.refunds_to_do,
      payments: payments.mode
    });
  });
}

module.exports = { registerFinanceRoutes };
