// Pagamentos internacionais: PayPal e RedotPay (cripto / cartão RedotPay). Servem quem está fora de Angola
// (ou não tem Multicaixa). Nenhum dos dois cobra em kwanzas: o valor é convertido para dólares
// (ou para a moeda escolhida) à taxa PAYMENTS_KZ_PER_USD, definida pela equipa no .env.
//
// PayPal (Orders v2):  criar ordem → a pessoa aprova no PayPal → volta a /api/payments/paypal/return
//                      → capturamos o pagamento → produto entregue. Nunca confiamos no regresso sem capturar.
// RedotPay (Connect):  criar ordem (pedido assinado com a nossa chave RSA) → a pessoa paga na página da RedotPay
//                      → a RedotPay chama o webhook (assinado com a chave pública DELES) → produto entregue.
const crypto = require("node:crypto");

// Kz → dólares, sempre arredondado PARA CIMA ao cêntimo (nunca recebemos menos do que o preço).
function convertKz(amountKz, kzPerUnit) {
  const rate = Number(kzPerUnit);
  if (!(rate > 0)) throw new Error("Falta a taxa de câmbio (PAYMENTS_KZ_PER_USD).");
  const value = Math.ceil((Number(amountKz) / rate) * 100) / 100;
  return Math.max(value, 1).toFixed(2); // mínimo 1.00
}

// ---------------------------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------------------------
function createPayPal({ clientId, clientSecret, environment = "sandbox", currency = "USD", kzPerUnit, fetchImpl = fetch }) {
  const base = environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  let cached = null;

  async function token() {
    if (cached && cached.expires > Date.now() + 60_000) return cached.value;
    const response = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials"
    });
    /** @type {any} */
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(`PayPal: autenticação falhou (${response.status}).`);
    cached = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 300) * 1000 };
    return cached.value;
  }

  async function call(method, path, body, extraHeaders = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined
    });
    /** @type {any} */
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`PayPal ${method} ${path} falhou (${response.status}) ${data.name || ""} ${data.details?.[0]?.issue || ""}`.trim());
    return data;
  }

  return {
    method: "paypal",
    currency,
    environment,
    amountFor: amountKz => convertKz(amountKz, kzPerUnit),
    // Cria a ordem e devolve o link para a pessoa aprovar no PayPal.
    async createOrder({ paymentId, amountKz, name, returnUrl, cancelUrl }) {
      const value = convertKz(amountKz, kzPerUnit);
      const order = await call("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: `tchilar-${paymentId}`,
          custom_id: String(paymentId),
          description: String(name || "Tchilar").slice(0, 127),
          amount: { currency_code: currency, value }
        }],
        payment_source: { paypal: { experience_context: {
          brand_name: "Tchilar", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", locale: "pt-PT",
          return_url: returnUrl, cancel_url: cancelUrl
        } } }
      }, { "PayPal-Request-Id": `tchilar-order-${paymentId}` });
      const approve = (order.links || []).find(link => link.rel === "payer-action" || link.rel === "approve");
      if (!approve) throw new Error("PayPal: a ordem não trouxe o link de aprovação.");
      return { orderId: order.id, approveUrl: approve.href, value };
    },
    // Captura (cobra) uma ordem aprovada. Devolve "paid" só se o valor e a moeda baterem certo.
    async capture(orderId, expectedValue) {
      let order = await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      if (order.status === "APPROVED") {
        order = await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { "PayPal-Request-Id": `tchilar-capture-${orderId}` });
      }
      if (order.status !== "COMPLETED") return order.status === "VOIDED" ? "failed" : "pending";
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture || capture.status !== "COMPLETED") return "pending";
      if (capture.amount?.currency_code !== currency || Number(capture.amount?.value) + 0.001 < Number(expectedValue)) return "underpaid";
      return "paid";
    }
  };
}

// ---------------------------------------------------------------------------------------------
// RedotPay (Connect API)
// ---------------------------------------------------------------------------------------------
const pem = value => String(value || "").replace(/\\n/g, "\n").trim();

// Assinatura de um pedido nosso: "{MÉTODO} {caminho}\n{appKey}.{timestamp}.{corpo}", SHA256withRSA, Base64.
function signRedotPay({ method, uri, appKey, timestamp, body, privateKey }) {
  const text = `${method.toUpperCase()} ${uri}\n${appKey}.${timestamp}.${body}`;
  return crypto.sign("RSA-SHA256", Buffer.from(text, "utf8"), pem(privateKey)).toString("base64");
}

// Assinatura de um webhook da RedotPay: "{appKey}.{timestamp}.{corpo}", verificada com a chave pública DELES.
// Só aceita avisos com menos de 5 minutos (contra repetições).
function verifyRedotPayWebhook({ rawBody, headers, appKey, platformPublicKey, now = Date.now() }) {
  const timestamp = String(headers["x-r-ts"] || "");
  const signature = String(headers["x-r-signature"] || "");
  if (!/^\d{10,16}$/.test(timestamp) || !signature || !platformPublicKey) return false;
  if (Math.abs(now - Number(timestamp)) > 5 * 60 * 1000) return false;
  try {
    return crypto.verify("RSA-SHA256", Buffer.from(`${appKey}.${timestamp}.${rawBody}`, "utf8"), pem(platformPublicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function createRedotPay({ appKey, privateKey, keyVersion = "1", environment = "sandbox", currency = "USD", kzPerUnit, platformPublicKey, fetchImpl = fetch }) {
  const base = environment === "production" ? "https://acquirer.redotpay.com" : "https://acquirersandbox.rp-2023app.com";

  async function call(uri, payload) {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const response = await fetchImpl(`${base}${uri}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-R-AK": appKey, "X-R-TS": timestamp, "X-R-KEY-VERSION": String(keyVersion),
        "X-R-Signature": signRedotPay({ method: "POST", uri, appKey, timestamp, body, privateKey })
      },
      body
    });
    /** @type {any} */
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== "SUCCESS") throw new Error(`RedotPay ${uri} falhou (${response.status}) ${data.code || ""} ${data.msg || ""}`.trim());
    return data.data || {};
  }

  return {
    method: "redotpay",
    currency,
    environment,
    amountFor: amountKz => convertKz(amountKz, kzPerUnit),
    async createOrder({ paymentId, amountKz, redirectUrl }) {
      const amount = convertKz(amountKz, kzPerUnit);
      const data = await call("/openapi/v2/order/create", { orderId: `tchilar-${paymentId}`, amount, currency, redirectUrl });
      const payUrl = data.h5Url || data.webUrl || data.payUrl;
      if (!payUrl) throw new Error("RedotPay: a ordem não trouxe o link de pagamento.");
      return { orderSn: data.orderSn || data.sn || `tchilar-${paymentId}`, payUrl, amount };
    },
    verifyWebhook: (rawBody, headers) => verifyRedotPayWebhook({ rawBody, headers, appKey, platformPublicKey })
  };
}

module.exports = { convertKz, createPayPal, createRedotPay, signRedotPay, verifyRedotPayWebhook };
