// Pagamentos num só ponto. Cada produto (promoções, estrelas, campanhas) regista o que acontece
// quando o pagamento é confirmado; a forma de pagar (hoje Stripe, ou demonstração sem Stripe em
// desenvolvimento) fica escondida aqui. Um novo método — por exemplo Multicaixa Express através
// de um agregador — liga-se em start()/refund() e chama fulfill() quando o agregador confirmar.
function createPayments({ stripe, isProduction, appUrl, currency }) {
  const fulfillers = new Map();

  const register = (purpose, fulfill) => fulfillers.set(purpose, fulfill);

  // details: { paymentIntent } — guardado para permitir reembolsos.
  const fulfill = async (purpose, refId, details = {}) => {
    const handler = fulfillers.get(purpose);
    if (!handler || !Number.isSafeInteger(refId)) return false;
    await handler(refId, details);
    return true;
  };

  const mode = stripe ? "stripe" : isProduction ? "off" : "demo";

  // Inicia um pagamento único. Devolve { checkoutUrl } (Stripe), { activated, demo } ou { error }.
  async function start({ purpose, refId, amountKz, name, email, userId, successPath, cancelPath, onSession }) {
    if (!stripe) {
      if (isProduction) return { error: "Os pagamentos ainda não estão disponíveis." };
      await fulfill(purpose, refId, { demo: true });
      return { activated: true, demo: true };
    }
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
    return { checkoutUrl: session.url };
  }

  // Chamado pelo webhook da Stripe quando um checkout de pagamento único fica pago.
  async function handleCheckoutSession(session) {
    if (session.mode !== "payment" || session.payment_status !== "paid") return false;
    const purpose = session.metadata?.purpose;
    // ad_id: promoções pagas antes desta versão.
    const refId = Number(session.metadata?.ref_id ?? session.metadata?.ad_id);
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    return fulfill(purpose, refId, { paymentIntent: paymentIntent || null });
  }

  // Devolve o dinheiro de um pagamento. Estados: refunded (feito), not_needed (demonstração),
  // manual (sem forma automática: a equipa tem de devolver à mão) ou failed (a Stripe recusou).
  async function refund({ paymentIntent, demo }) {
    if (demo || (!stripe && !isProduction)) return { status: "not_needed" };
    if (!stripe || !paymentIntent) return { status: "manual" };
    try {
      await stripe.refunds.create({ payment_intent: paymentIntent });
      return { status: "refunded" };
    } catch (error) {
      console.error("Refund failed:", error.message);
      return { status: "failed" };
    }
  }

  return { mode, register, start, fulfill, refund, handleCheckoutSession };
}

module.exports = { createPayments };
