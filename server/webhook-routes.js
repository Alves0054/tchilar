// Webhooks dos pagamentos e regresso do PayPal.
// Separado de index.js: as rotas são as mesmas; recebem de lá o que partilham com o resto da API.
const crypto = require("crypto");
const express = require("express");

function registerWebhookRoutes(app, deps) {
  const {
    appUrl, applyStripeSubscription, parseId, payments, paypay, proxypay, redotpay, stripe, stripeWebhookSecret
  } = deps;

  // A Stripe assina o corpo original do pedido: este endpoint tem de ler o corpo em bruto,
  // por isso é registado antes do express.json().
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    if (!stripe || !stripeWebhookSecret) return res.status(503).json({ error: "Pagamentos não configurados." });
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] || "", stripeWebhookSecret);
    } catch {
      return res.status(400).json({ error: "Assinatura do webhook inválida." });
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // Pagamentos únicos (promoções, estrelas, campanhas): cada um ativa-se sozinho quando o pagamento chega.
      await payments.handleCheckoutSession(session);
      if (session.mode === "subscription" && session.subscription) {
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await applyStripeSubscription(await stripe.subscriptions.retrieve(subscriptionId));
      }
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      await payments.handleCheckoutSession(event.data.object);
    } else if (event.type.startsWith("customer.subscription.")) {
      await applyStripeSubscription(event.data.object);
    }
    res.json({ received: true });
  });

  // ProxyPay: pagamentos por referência. Só aceita notificações com assinatura HMAC válida.
  app.post("/api/webhooks/proxypay", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
    if (!proxypay) return res.status(503).json({ error: "Pagamentos por referência não configurados." });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!proxypay.verifySignature(raw, req.headers["x-signature"])) return res.status(401).json({ error: "Assinatura inválida." });
    let payment;
    try {
      payment = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Corpo inválido." });
    }
    try {
      await payments.handleProxyPayPayment(payment);
      res.json({ received: true });
    } catch (error) {
      console.error("ProxyPay webhook:", error.message);
      res.status(500).json({ error: "Erro ao processar." });
    }
  });

  // Paybyrd: Multicaixa Express. O conteúdo da notificação não é usado como prova: o estado
  // é sempre confirmado com a Paybyrd antes de se dar o pagamento por feito.
  app.post("/api/webhooks/paybyrd", express.json({ limit: "100kb" }), async (req, res) => {
    const body = req.body || {};
    const transactionId = body.transactionId || body.content?.transactionId || body.data?.transactionId || body.transaction?.transactionId;
    try {
      await payments.refreshExpressByTransaction(transactionId);
    } catch (error) {
      console.error("Paybyrd webhook:", error.message);
    }
    res.json({ received: true });
  });

  // RedotPay: só aceita avisos assinados pela RedotPay (chave pública deles, por ambiente) e com menos de 5 minutos.
  app.post("/api/webhooks/redotpay", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    let payload = {};
    try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }
    const requestId = typeof payload.requestId === "string" ? payload.requestId : crypto.randomUUID();
    if (!redotpay) return res.status(503).json({ code: "FAIL", requestId, msg: "RedotPay não configurado." });
    if (!redotpay.verifyWebhook(raw, req.headers)) return res.status(401).json({ code: "FAIL", requestId, msg: "Assinatura inválida." });
    try {
      await payments.handleRedotPayNotification(payload);
      res.json({ code: "SUCCESS", requestId });
    } catch (error) {
      console.error("RedotPay webhook:", error.message);
      res.status(500).json({ code: "FAIL", requestId, msg: "Erro ao processar." });
    }
  });

  // PayPay Africa: aviso assinado pela PayPay (formulário, não JSON). Só serve para perguntar o estado
  // à PayPay; a resposta tem de ser exatamente "success" (senão a PayPay repete o aviso).
  app.post("/api/webhooks/paypay", express.urlencoded({ extended: false, limit: "100kb" }), async (req, res) => {
    if (!paypay) return res.status(503).type("text/plain").send("fail");
    const params = req.body && typeof req.body === "object" ? req.body : {};
    if (!paypay.verifyNotification(params)) return res.status(401).type("text/plain").send("fail");
    try {
      await payments.refreshPayPayByTradeNo(typeof params.out_trade_no === "string" ? params.out_trade_no : null);
      res.type("text/plain").send("success");
    } catch (error) {
      console.error("PayPay webhook:", error.message);
      res.status(500).type("text/plain").send("fail");
    }
  });

  // PayPal: a pessoa volta aqui depois de aprovar. Capturamos o pagamento e mandamo-la para a página certa.
  app.get("/api/payments/paypal/return", async (req, res) => {
    const id = parseId(req.query.payment);
    let target = "/";
    try {
      const result = id ? await payments.capturePayPal(id, typeof req.query.token === "string" ? req.query.token : null) : { path: "/" };
      target = result.path || "/";
    } catch (error) {
      console.error("PayPal return:", error.message);
    }
    // Só caminhos do próprio site (nunca endereços de fora).
    res.redirect(303, new URL(target.startsWith("/") && !target.startsWith("//") ? target : "/", appUrl).toString());
  });
}

module.exports = { registerWebhookRoutes };
