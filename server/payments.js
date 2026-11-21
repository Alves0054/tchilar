// Pagamentos num só ponto. Cada produto (promoções, estrelas, campanhas) regista o que acontece
// quando o pagamento é confirmado; os métodos ficam escondidos aqui:
//   express   — Multicaixa Express (Paybyrd), pedido enviado para a app do telemóvel
//   reference — Pagamento por Referência (ProxyPay), Entidade + Referência + Valor
//   card      — cartão (Stripe Checkout)
//   paypal    — PayPal (cobra em dólares, à taxa PAYMENTS_KZ_PER_USD)
//   redotpay  — RedotPay (cripto e cartão RedotPay, em dólares)
//   paypay    — PayPay Africa, aprovado na app PayPay (botão ou QR code), em kwanzas
//   demo      — só com NODE_ENV=development e sem nenhum método configurado: ativa sem cobrar
const { normalizeAngolanPhone } = require("./angola-payments");
const { resolvePromotionCode, recordPromotionCodeUse } = require("./promotion-codes");

const REFERENCE_VALID_DAYS = 3;
// Produtos cujo registo guarda o valor da venda (amount_kz). Com código promocional, o registo passa a ter o valor
// realmente pago: é dele que saem a parte do criador (cursos, grupos, subscrições), as receitas e os reembolsos.
// As promoções e as campanhas ficam de fora: o orçamento (budget) é o produto comprado, o desconto é do Tchilar.
const SALE_AMOUNT_TABLES = {
  stars: "star_purchases", group_access: "group_access_purchases", course: "course_purchases",
  subscription: "subscription_payments", verification: "verification_purchases"
};
// Todos os métodos que o Tchilar conhece, pela ordem em que aparecem. Os que não têm chaves aparecem como "Em breve".
const ALL_METHODS = ["express", "reference", "paypay", "card", "paypal", "redotpay"];

// allowSimulation: só true com pagamentos de demonstração ligados (NODE_ENV=development + PAYMENTS_DEMO=true).
// Simular uma referência paga cria estrelas sem dinheiro real, e as estrelas podem ser levantadas pelos
// criadores: nunca pode estar disponível num servidor público.
function createPayments({ stripe, isProduction, appUrl, apiUrl = appUrl, currency, pool, proxypay = null, paybyrd = null, paypal = null, redotpay = null, paypay = null, payerIp = () => null, qrCode = null, allowSimulation = false }) {
  const fulfillers = new Map();
  const register = (purpose, fulfill) => fulfillers.set(purpose, fulfill);

  // details: { paymentIntent } (Stripe), { localPaymentId, method } (Express/Referência) ou { demo }.
  const fulfill = async (purpose, refId, details = {}) => {
    const handler = fulfillers.get(purpose);
    if (!handler || !Number.isSafeInteger(refId)) return false;
    await handler(refId, details);
    if (details.promoCodeId) {
      await recordPromotionCodeUse(pool, {
        codeId: details.promoCodeId,
        userId: details.userId,
        purpose,
        refId,
        originalAmount: details.originalAmount,
        discountAmount: details.discountAmount,
        paidAmount: details.paidAmount
      });
    }
    return true;
  };

  const methods = [...(paybyrd ? ["express"] : []), ...(proxypay ? ["reference"] : []), ...(stripe ? ["card"] : []),
    ...(paypal ? ["paypal"] : []), ...(redotpay ? ["redotpay"] : []), ...(paypay ? ["paypay"] : [])];
  const upcoming = ALL_METHODS.filter(method => !methods.includes(method));
  // "stripe" mantém-se como nome do modo real por compatibilidade com o resto do código.
  const mode = methods.length ? "stripe" : isProduction ? "off" : "demo";

  // ---------------------------------------------------------------------------------------------
  // Iniciar um pagamento único
  // ---------------------------------------------------------------------------------------------
  async function start({ purpose, refId, amountKz, name, email, userId, successPath, cancelPath, onSession, method, phone, promoCode }) {
    const promotion = await resolvePromotionCode(pool, { code: promoCode, purpose, amountKz, userId });
    if ("error" in promotion) return { error: promotion.error };
    amountKz = promotion.amount;
    // Cada tentativa de compra cria um registo novo, por isso só é preciso mexer quando há código.
    const saleTable = SALE_AMOUNT_TABLES[purpose];
    if (promotion.code && saleTable && Number.isSafeInteger(refId)) {
      await pool.query(`UPDATE ${saleTable} SET amount_kz=$1::numeric WHERE id=$2 AND status='pending'`, [promotion.paid, refId]);
    }
    const promoDetails = promotion.code ? {
      promoCodeId: promotion.code.id,
      originalAmount: promotion.original,
      discountAmount: promotion.discount,
      paidAmount: promotion.paid,
      userId
    } : {};
    if (!methods.length) {
      if (isProduction) return { error: "Os pagamentos ainda não estão disponíveis." };
      await fulfill(purpose, refId, { demo: true, ...promoDetails });
      if (!promotion.code) return { activated: true, demo: true };
      return { activated: true, demo: true, originalAmount: promotion.original, discountAmount: promotion.discount, amount: promotion.paid };
    }
    const chosen = method || (methods.length === 1 ? methods[0] : null);
    if (!chosen || !methods.includes(chosen)) return { error: "Escolhe um método de pagamento disponível.", methods };

    if (chosen === "card") {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        client_reference_id: String(userId),
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: Math.round(Number(amountKz) * 100), product_data: { name } } }],
        metadata: {
          purpose,
          ref_id: String(refId),
          user_id: String(userId),
          promo_code_id: promoDetails.promoCodeId ? String(promoDetails.promoCodeId) : "",
          promo_original_amount: promoDetails.originalAmount ? String(promoDetails.originalAmount) : "",
          promo_discount_amount: promoDetails.discountAmount ? String(promoDetails.discountAmount) : "",
          promo_paid_amount: promoDetails.paidAmount ? String(promoDetails.paidAmount) : ""
        },
        success_url: new URL(successPath, appUrl).toString(),
        cancel_url: new URL(cancelPath, appUrl).toString()
      });
      if (onSession) await onSession(session.id);
      return { method: "card", checkoutUrl: session.url };
    }

    // PayPal e RedotPay: fica um pagamento pendente; a pessoa paga na página do fornecedor e volta.
    if (chosen === "paypal" || chosen === "redotpay") {
      const provider = chosen === "paypal" ? paypal : redotpay;
      const pending = await pool.query(`
        INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,charged_currency,success_path,cancel_path,expires_at,promo_code_id,promo_original_amount,promo_discount_amount,promo_paid_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() + INTERVAL '3 hours',$10,$11,$12,$13) RETURNING id`,
      [purpose, refId, userId, chosen, amountKz, `pending-${Date.now()}-${refId}`, provider.currency, successPath, cancelPath,
        promoDetails.promoCodeId || null, promoDetails.originalAmount || null, promoDetails.discountAmount || null, promoDetails.paidAmount || null]);
      const paymentId = pending.rows[0].id;
      try {
        if (chosen === "paypal") {
          const order = await paypal.createOrder({
            paymentId, amountKz, name,
            returnUrl: new URL(`/api/payments/paypal/return?payment=${paymentId}`, apiUrl).toString(),
            cancelUrl: new URL(cancelPath, appUrl).toString()
          });
          await pool.query("UPDATE local_payments SET provider_ref=$2, charged_amount=$3 WHERE id=$1", [paymentId, order.orderId, order.value]);
          return { method: "paypal", paymentId, checkoutUrl: order.approveUrl, charged: `${order.value} ${paypal.currency}` };
        }
        const order = await redotpay.createOrder({ paymentId, amountKz, redirectUrl: new URL(successPath, appUrl).toString() });
        await pool.query("UPDATE local_payments SET provider_ref=$2, charged_amount=$3 WHERE id=$1", [paymentId, order.orderSn, order.amount]);
        return { method: "redotpay", paymentId, checkoutUrl: order.payUrl, charged: `${order.amount} ${redotpay.currency}` };
      } catch (error) {
        await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1", [paymentId]);
        console.error(`${chosen}:`, error.message);
        return { error: `Não foi possível abrir o pagamento por ${chosen === "paypal" ? "PayPal" : "RedotPay"}. Tenta novamente.` };
      }
    }

    // PayPay Africa: a pessoa aprova na app PayPay (botão no telemóvel, QR code no computador).
    if (chosen === "paypay") {
      const pending = await pool.query(
        `INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,success_path,cancel_path,promo_code_id,promo_original_amount,promo_discount_amount,promo_paid_amount)
         VALUES($1,$2,$3,'paypay',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [purpose, refId, userId, amountKz, `pending-${Date.now()}-${refId}`, successPath, cancelPath,
          promoDetails.promoCodeId || null, promoDetails.originalAmount || null, promoDetails.discountAmount || null, promoDetails.paidAmount || null]);
      const paymentId = pending.rows[0].id;
      try {
        const order = await paypay.createPayment({ paymentId, amountKz, subject: name, payerIp: payerIp(), returnUrl: new URL(successPath, appUrl).toString() });
        await pool.query("UPDATE local_payments SET provider_ref=$2, expires_at=$3 WHERE id=$1", [paymentId, order.outTradeNo, order.expiresAt]);
        const qrCodeUrl = order.dynamicLink && qrCode ? await qrCode(order.dynamicLink).catch(() => null) : null;
        return { method: "paypay", paymentId, deeplink: order.deeplink, link: order.dynamicLink, qrCodeUrl, expiresAt: order.expiresAt };
      } catch (error) {
        await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1", [paymentId]);
        console.error("PayPay:", error.message);
        return { error: "Não foi possível abrir o pagamento PayPay. Tenta novamente." };
      }
    }

    if (chosen === "express") {
      const number = normalizeAngolanPhone(phone);
      if (!number) return { error: "Indica o número de telemóvel associado ao Multicaixa Express (9 dígitos, começa por 9)." };
      const pending = await pool.query(
        `INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,phone_last3,promo_code_id,promo_original_amount,promo_discount_amount,promo_paid_amount)
         VALUES($1,$2,$3,'express',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [purpose, refId, userId, amountKz, `pending-${Date.now()}-${refId}`, number.slice(-3),
          promoDetails.promoCodeId || null, promoDetails.originalAmount || null, promoDetails.discountAmount || null, promoDetails.paidAmount || null]);
      const paymentId = pending.rows[0].id;
      try {
        const created = await paybyrd.createExpressPayment({
          amountKz, phone: number, orderRef: `tchilar-${paymentId}`, redirectUrl: new URL(successPath, appUrl).toString()
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
        INSERT INTO local_payments(purpose,ref_id,user_id,method,amount_kz,provider_ref,entity,expires_at,promo_code_id,promo_original_amount,promo_discount_amount,promo_paid_amount)
        VALUES($1,$2,$3,'reference',$4,$5,$6,($7::date + INTERVAL '1 day' - INTERVAL '1 second'),$8,$9,$10,$11) RETURNING id, expires_at`,
      [purpose, refId, userId, amountKz, reference, proxypay.entityId, endDate,
        promoDetails.promoCodeId || null, promoDetails.originalAmount || null, promoDetails.discountAmount || null, promoDetails.paidAmount || null]);
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
      "UPDATE local_payments SET status='paid', paid_at=NOW() WHERE id=$1 AND status='pending' RETURNING purpose, ref_id, method, user_id, promo_code_id, promo_original_amount, promo_discount_amount, promo_paid_amount",
      [paymentId]);
    if (!result.rowCount) return false;
    const row = result.rows[0];
    await fulfill(row.purpose, row.ref_id, row.promo_code_id ? {
      localPaymentId: paymentId, method: row.method, promoCodeId: row.promo_code_id,
      userId: row.user_id, originalAmount: row.promo_original_amount,
      discountAmount: row.promo_discount_amount, paidAmount: row.promo_paid_amount
    } : { localPaymentId: paymentId, method: row.method });
    return true;
  }

  // A equipa confirma à mão um pagamento que o fornecedor não confirmou (ex.: a pessoa mostra o comprovativo
  // do banco e a referência já tinha expirado). Entrega o produto uma única vez, como o settle.
  async function confirmManually(paymentId) {
    const result = await pool.query(
      "UPDATE local_payments SET status='paid', paid_at=NOW() WHERE id=$1 AND status<>'paid' RETURNING purpose, ref_id, method, user_id, promo_code_id, promo_original_amount, promo_discount_amount, promo_paid_amount",
      [paymentId]);
    if (!result.rowCount) return false;
    const row = result.rows[0];
    await fulfill(row.purpose, row.ref_id, row.promo_code_id ? {
      localPaymentId: paymentId, method: row.method, promoCodeId: row.promo_code_id,
      userId: row.user_id, originalAmount: row.promo_original_amount,
      discountAmount: row.promo_discount_amount, paidAmount: row.promo_paid_amount
    } : { localPaymentId: paymentId, method: row.method });
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

  // PayPay: pergunta o estado à PayPay (as notificações só servem de aviso para perguntar).
  // Só dá por pago com o valor completo.
  async function refreshPayPay(row) {
    const { state, amount } = await paypay.getState(row.provider_ref);
    if (state === "paid") {
      if (!(amount + 0.001 >= Number(row.amount_kz))) {
        console.error(`PayPay ${row.provider_ref}: pago ${amount} Kz, esperado ${row.amount_kz} Kz.`);
        return "underpaid";
      }
      await settle(row.id);
    } else if (state === "failed") {
      await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1 AND status='pending'", [row.id]);
    }
    return state;
  }

  async function refreshPayPayByTradeNo(outTradeNo) {
    if (!paypay || !outTradeNo) return false;
    const found = await pool.query("SELECT * FROM local_payments WHERE method='paypay' AND provider_ref=$1", [String(outTradeNo)]);
    if (!found.rowCount || found.rows[0].status !== "pending") return false;
    await refreshPayPay(found.rows[0]);
    return true;
  }

  // PayPal: depois de a pessoa aprovar, cobra (captura) e entrega. Devolve o caminho para onde ela volta.
  async function capturePayPal(paymentId, orderId) {
    const found = await pool.query("SELECT * FROM local_payments WHERE id=$1 AND method='paypal'", [paymentId]);
    const row = found.rows[0];
    if (!row || !paypal || (orderId && row.provider_ref !== orderId)) return { ok: false, path: "/" };
    if (row.status === "paid") return { ok: true, path: row.success_path || "/" };
    const state = await paypal.capture(row.provider_ref, row.charged_amount);
    if (state === "paid") { await settle(row.id); return { ok: true, path: row.success_path || "/" }; }
    if (state === "underpaid") console.error(`PayPal ${row.provider_ref}: valor capturado abaixo do esperado.`);
    if (state === "failed") await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1 AND status='pending'", [row.id]);
    return { ok: false, path: row.cancel_path || "/" };
  }

  // RedotPay: aviso de pagamento (já com a assinatura verificada). orderStatus 2 = pago.
  async function handleRedotPayNotification(payload) {
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
    const outer = String(data.outerOrderSn || data.outerOrder || "");
    const id = Number(outer.replace(/^tchilar-/, ""));
    if (!outer || !Number.isSafeInteger(id)) return "unknown";
    const found = await pool.query("SELECT id, charged_amount::float AS charged, charged_currency FROM local_payments WHERE id=$1 AND method='redotpay'", [id]);
    const row = found.rows[0];
    if (!row) return "unknown";
    const status = Number(data.orderStatus);
    if (status === 3 || status === 4) {
      await pool.query("UPDATE local_payments SET status='failed' WHERE id=$1 AND status='pending'", [row.id]);
      return "failed";
    }
    if (status !== 2) return "pending";
    if (String(data.orderCurrency || row.charged_currency) !== row.charged_currency || Number(data.orderAmount) + 0.001 < row.charged) {
      console.error(`RedotPay ${outer}: pago ${data.orderAmount} ${data.orderCurrency}, esperado ${row.charged} ${row.charged_currency}.`);
      return "underpaid";
    }
    await settle(row.id);
    return "settled";
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
    if (row.status === "pending" && row.method === "paypal" && paypal && !row.provider_ref.startsWith("pending-")) {
      try { await capturePayPal(row.id); } catch (error) { console.error("PayPal status:", error.message); }
      const fresh = await pool.query("SELECT status FROM local_payments WHERE id=$1", [row.id]);
      return { status: fresh.rows[0].status };
    }
    if (row.status === "pending" && row.method === "express") {
      try { await refreshExpress(row); } catch (error) { console.error("Paybyrd status:", error.message); }
      const fresh = await pool.query("SELECT status FROM local_payments WHERE id=$1", [row.id]);
      return { status: fresh.rows[0].status };
    }
    if (row.status === "pending" && row.method === "paypay" && paypay && !row.provider_ref.startsWith("pending-")) {
      try { await refreshPayPay(row); } catch (error) { console.error("PayPay status:", error.message); }
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
    const promoCodeId = Number(session.metadata?.promo_code_id);
    const details = { paymentIntent: paymentIntent || null };
    if (Number.isSafeInteger(promoCodeId) && promoCodeId > 0) {
      details.promoCodeId = promoCodeId;
      details.userId = Number(session.metadata?.user_id) || null;
      details.originalAmount = Number(session.metadata?.promo_original_amount);
      details.discountAmount = Number(session.metadata?.promo_discount_amount);
      details.paidAmount = Number(session.metadata?.promo_paid_amount);
    }
    return fulfill(purpose, refId, details);
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
    mode, methods, upcoming, register, start, fulfill, refund, handleCheckoutSession, confirmManually,
    handleProxyPayPayment, pollProxyPay, refreshExpressByTransaction, status, simulateReference, proxypay, paybyrd,
    capturePayPal, handleRedotPayNotification, refreshPayPayByTradeNo, paypal, redotpay, paypay
  };
}

module.exports = { createPayments };
