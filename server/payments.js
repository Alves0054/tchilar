// Pagamentos num só ponto. Cada produto (promoções, estrelas, campanhas) regista o que acontece
// quando o pagamento é confirmado; os métodos ficam escondidos aqui:
//   express   — Multicaixa Express (Paybyrd), pedido enviado para a app do telemóvel
//   reference — Pagamento por Referência (ProxyPay), Entidade + Referência + Valor
//   card      — cartão (Stripe Checkout)
//   demo      — só com NODE_ENV=development e sem nenhum método configurado: ativa sem cobrar
const { normalizeAngolanPhone } = require("./angola-payments");

const REFERENCE_VALID_DAYS = 3;

// allowSimulation: só true com pagamentos de demonstração ligados (NODE_ENV=development + PAYMENTS_DEMO=true).
// Simular uma referência paga cria estrelas sem dinheiro real, e as estrelas podem ser levantadas pelos
// criadores: nunca pode estar disponível num servidor público.
function createPayments({ stripe, isProduction, appUrl, currency, pool, proxypay = null, paybyrd = null, allowSimulation = false }) {
  const fulfillers = new Map();
  const register = (purpose, fulfill) => fulfillers.set(purpose, fulfill);

  // details: { paymentIntent } (Stripe), { localPaymentId, method } (Express/Referência) ou { demo }.
  const fulfill = async (purpose, refId, details = {}) => {
    const handler = fulfillers.get(purpose);
    if (!handler || !Number.isSafeInteger(refId)) return false;
    await handler(refId, details);
    return true;
  };

  const methods = [...(paybyrd ? ["express"] : []), ...(proxypay ? ["reference"] : []), ...(stripe ? ["card"] : [])];
  // "stripe" mantém-se como nome do modo real por compatibilidade com o resto do código.
  const mode = methods.length ? "stripe" : isProduction ? "off" : "demo";

  // ---------------------------------------------------------------------------------------------
  // Iniciar um pagamento único
  // ---------------------------------------------------------------------------------------------
  async function start({ purpose, refId, amountKz, name, email, userId, successPath, cancelPath, onSession, method, phone }) {
    if (!methods.length) {
      if (isProduction) return { error: "Os pagamentos ainda não estão disponíveis." };
      await fulfill(purpose, refId, { demo: true });
      return { activated: true, demo: true };
    }
    const chosen = method || (methods.length === 1 ? methods[0] : null);
    if (!chosen || !methods.includes(chosen)) return { error: "Escolhe um método de pagamento disponível.", methods };

    if (chosen === "card") {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        client_reference_id: String(userId),
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: Math.round(Number(amountKz) * 100), product_data: { name } } }],
        metadata: { purpose, ref_id: String(refId), user_id: String(userId) },
        success_url: new URL(successPath, appUrl).toString(),
        cancel_url: new URL(cancelPath, appUrl).toString()
      });
      if (onSession) await onSession(session.id);
      return { method: "card", checkoutUrl: session.url };
    }

    if (chosen === "express") {
      const number = normalizeAngolanPhone(phone);
      if (!number) return { error: "Indica o número de telemóvel associado ao Multicaixa Express (9 dígitos, começa por 9)." };
      const pending = await pool.query(
        "INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,phone_last3) VALUES($1,$2,$3,'express',$4,$5,$6) RETURNING id",
        [purpose, refId, userId, amountKz, `pending-${Date.now()}-${refId}`, number.slice(-3)]);
      const paymentId = pending.rows[0].id;
      try {
        const created = await paybyrd.createExpressPayment({
          amountKz, phone: number, orderRef: `biva-${paymentId}`, redirectUrl: new URL(successPath, appUrl).toString()
        });
        await pool.query("UPDATE local_payments SET provider_ref=$2, expires_at=$3 WHERE id=$1",
          [paymentId, created.transactionId, created.expiresAt || new Date(Date.now() + 10 * 60_000)]);
        if (created.state === "paid") await settle(paymentId);
        return { method: "express", paymentId, phone: `••• ••• ${number.slice(-3)}`, qrCodeUrl: created.qrCodeUrl, deeplink: created.deeplink, expiresAt: created.expiresAt };
      } catch (error) {
        await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1", [paymentId]);
        console.error("Multicaixa Express:", error.message);
        return { error: "Não foi possível enviar o pedido para o Multicaixa Express. Tenta novamente." };
      }
    }

    // Referência: válida durante alguns dias, até ao fim do último dia (hora de Angola).
    const endDate = new Date(Date.now() + REFERENCE_VALID_DAYS * 86_400_000).toISOString().slice(0, 10);
    try {
      const reference = await proxypay.createReference({ amountKz, endDate, customFields: { purpose, ref_id: refId } });
      const created = await pool.query(`
        INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,entity,expires_at)
        VALUES($1,$2,$3,'reference',$4,$5,$6,($7::date + INTERVAL '1 day' - INTERVAL '1 second')) RETURNING id, expires_at`,
      [purpose, refId, userId, amountKz, reference, proxypay.entityId, endDate]);
      return {
        method: "reference", paymentId: created.rows[0].id, entity: proxypay.entityId, reference,
        amount: Number(amountKz), expiresAt: created.rows[0].expires_at, sandbox: allowSimulation && proxypay.environment !== "production"
      };
    } catch (error) {
      console.error("ProxyPay:", error.message);
      return { error: "Não foi possível gerar a referência de pagamento. Tenta novamente." };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Confirmar pagamentos locais (Express / Referência)
  // ---------------------------------------------------------------------------------------------
  // Marca como pago uma única vez e entrega o produto. Seguro contra notificações repetidas.
  async function settle(paymentId) {
    const result = await pool.query(
      "UPDATE local_payments SET status='paid', paid_at=NOW() WHERE id=$1 AND status='pending' RETURNING purpose, ref_id, method",
      [paymentId]);
    if (!result.rowCount) return false;
    const row = result.rows[0];
    await fulfill(row.purpose, row.ref_id, { localPaymentId: paymentId, method: row.method });
    return true;
  }

  // Pagamento recebido da ProxyPay (webhook ou fila). O valor pago tem de cobrir o valor pedido.
  async function handleProxyPayPayment(payment) {
    const found = await pool.query(
      "SELECT id, amount_kz::float AS amount FROM local_payments WHERE method='reference' AND provider_ref=$1",
      [String(payment.reference_id)]);
    const row = found.rows[0];
    if (!row) return "unknown";
    if (Number(payment.amount) + 0.001 < row.amount) {
      console.error(`Referência ${payment.reference_id}: pago ${payment.amount}, esperado ${row.amount}.`);
      return "underpaid";
    }
    await settle(row.id);
    return "settled";
  }

  // Alternativa ao webhook: lê a fila de pagamentos da ProxyPay e confirma cada um depois de tratado.
  async function pollProxyPay() {
    if (!proxypay) return 0;
    const queue = await proxypay.listPayments();
    for (const payment of queue || []) {
      await handleProxyPayPayment(payment);
      await proxypay.acknowledgePayment(payment.id);
    }
    return (queue || []).length;
  }

  // Express: pergunta o estado à Paybyrd (nunca confiamos só no conteúdo de uma notificação).
  async function refreshExpress(row) {
    const state = await paybyrd.getState(row.provider_ref);
    if (state === "paid") await settle(row.id);
    else if (state === "failed") await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1 AND status='pending'", [row.id]);
    return state;
  }

  async function refreshExpressByTransaction(transactionId) {
    if (!paybyrd || !transactionId) return false;
    const found = await pool.query("SELECT * FROM local_payments WHERE method='express' AND provider_ref=$1", [String(transactionId)]);
    if (!found.rowCount || found.rows[0].status !== "pending") return false;
    await refreshExpress(found.rows[0]);
    return true;
  }

  // Estado de um pagamento local, para o ecrã de pagamento ir perguntando.
  async function status(paymentId, userId) {
    const found = await pool.query("SELECT * FROM local_payments WHERE id=$1 AND user_id=$2", [paymentId, userId]);
    const row = found.rows[0];
    if (!row) return null;
    if (row.status === "pending" && row.expires_at && new Date(row.expires_at) < new Date()) {
      await pool.query("UPDATE local_payments SET status='expired' WHERE id=$1 AND status='pending'", [row.id]);
      return { status: "expired" };
    }
    if (row.status === "pending" && row.method === "express") {
      try { await refreshExpress(row); } catch (error) { console.error("Paybyrd status:", error.message); }
      const fresh = await pool.query("SELECT status FROM local_payments WHERE id=$1", [row.id]);
      return { status: fresh.rows[0].status };
    }
    return { status: row.status };
  }

  // Só no sandbox da ProxyPay: simula o pagamento de uma referência (para testar sem dinheiro).
  async function simulateReference(paymentId, userId) {
    if (!allowSimulation || !proxypay || proxypay.environment === "production") return false;
    const found = await pool.query("SELECT provider_ref, amount_kz FROM local_payments WHERE id=$1 AND user_id=$2 AND method='reference'", [paymentId, userId]);
    if (!found.rowCount) return false;
    await proxypay.mockPayment(found.rows[0].provider_ref, found.rows[0].amount_kz);
    await pollProxyPay().catch(() => {});
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Stripe
  // ---------------------------------------------------------------------------------------------
  async function handleCheckoutSession(session) {
    if (session.mode !== "payment" || session.payment_status !== "paid") return false;
    const purpose = session.metadata?.purpose;
    const refId = Number(session.metadata?.ref_id ?? session.metadata?.ad_id);
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    return fulfill(purpose, refId, { paymentIntent: paymentIntent || null });
  }

  // Devolve o dinheiro. Estados: refunded (feito), not_needed (demonstração), manual (sem forma
  // automática — Express e Referência são devolvidos à mão pela equipa) ou failed (a Stripe recusou).
  async function refund({ paymentIntent, demo }) {
    if (demo || mode === "demo") return { status: "not_needed" };
    if (!stripe || !paymentIntent) return { status: "manual" };
    try {
      await stripe.refunds.create({ payment_intent: paymentIntent });
      return { status: "refunded" };
    } catch (error) {
      console.error("Refund failed:", error.message);
      return { status: "failed" };
    }
  }

  return {
    mode, methods, register, start, fulfill, refund, handleCheckoutSession,
    handleProxyPayPayment, pollProxyPay, refreshExpressByTransaction, status, simulateReference, proxypay, paybyrd
  };
}

module.exports = { createPayments };
