const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { convertKz, createPayPal, createRedotPay, signRedotPay, verifyRedotPayWebhook } = require("./global-payments");

test("kwanzas become dollars rounded up to the cent, never below 1.00", () => {
  assert.equal(convertKz(9200, 920), "10.00");
  assert.equal(convertKz(1000, 920), "1.09", "1,0869… arredonda para cima");
  assert.equal(convertKz(100, 920), "1.00", "mínimo 1 dólar");
  assert.throws(() => convertKz(1000, undefined), /PAYMENTS_KZ_PER_USD/);
});

// Um "PayPal" falso: guarda os pedidos e responde como a API Orders v2.
function fakePayPal({ captureValue = "10.00", captureCurrency = "USD", status = "APPROVED" } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body && options.body !== "grant_type=client_credentials" ? JSON.parse(options.body) : null });
    const reply = data => ({ ok: true, status: 200, json: async () => data });
    if (url.endsWith("/v1/oauth2/token")) return reply({ access_token: "token-de-teste", expires_in: 3600 });
    if (url.endsWith("/v2/checkout/orders")) return reply({ id: "ORDEM1", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDEM1" }] });
    if (url.endsWith("/capture")) return reply({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ status: "COMPLETED", amount: { value: captureValue, currency_code: captureCurrency } }] } }] });
    return reply({ id: "ORDEM1", status });
  };
  return { calls, fetchImpl };
}

test("PayPal: creates the order in dollars and only counts it paid after a full capture", async () => {
  const fake = fakePayPal();
  const paypal = createPayPal({ clientId: "id", clientSecret: "segredo", kzPerUnit: 920, fetchImpl: fake.fetchImpl });
  const order = await paypal.createOrder({ paymentId: 7, amountKz: 9200, name: "500 estrelas", returnUrl: "https://tchilar.ao/api/payments/paypal/return?payment=7", cancelUrl: "https://tchilar.ao/estrelas" });
  assert.equal(order.approveUrl, "https://www.sandbox.paypal.com/checkoutnow?token=ORDEM1");
  const sent = fake.calls.find(call => call.url.endsWith("/v2/checkout/orders")).body;
  assert.deepEqual(sent.purchase_units[0].amount, { currency_code: "USD", value: "10.00" });
  assert.equal(sent.purchase_units[0].custom_id, "7");
  assert.equal(await paypal.capture("ORDEM1", "10.00"), "paid");

  const short = createPayPal({ clientId: "id", clientSecret: "segredo", kzPerUnit: 920, fetchImpl: fakePayPal({ captureValue: "5.00" }).fetchImpl });
  assert.equal(await short.capture("ORDEM1", "10.00"), "underpaid", "pago a menos: não entrega");
  const euros = createPayPal({ clientId: "id", clientSecret: "segredo", kzPerUnit: 920, fetchImpl: fakePayPal({ captureCurrency: "EUR" }).fetchImpl });
  assert.equal(await euros.capture("ORDEM1", "10.00"), "underpaid", "moeda diferente: não entrega");
  const waiting = createPayPal({ clientId: "id", clientSecret: "segredo", kzPerUnit: 920, fetchImpl: fakePayPal({ status: "CREATED" }).fetchImpl });
  assert.equal(await waiting.capture("ORDEM1", "10.00"), "pending", "ainda não aprovou");
});

test("RedotPay: requests are signed with our key and webhooks only count with THEIR signature", async () => {
  const ours = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const theirs = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pemOf = key => key.export({ type: key.type === "private" ? "pkcs8" : "spki", format: "pem" });
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ code: "SUCCESS", data: { orderSn: "SN123", h5Url: "https://pay.redotpay.com/h5/SN123" } }) };
  };
  const redotpay = createRedotPay({ appKey: "app-key", privateKey: pemOf(ours.privateKey), kzPerUnit: 920, platformPublicKey: pemOf(theirs.publicKey), fetchImpl });
  const order = await redotpay.createOrder({ paymentId: 9, amountKz: 18400, redirectUrl: "https://tchilar.ao/estrelas" });
  assert.deepEqual(order, { orderSn: "SN123", payUrl: "https://pay.redotpay.com/h5/SN123", amount: "20.00" });
  assert.equal(request.url, "https://acquirersandbox.rp-2023app.com/openapi/v2/order/create");
  const headers = request.options.headers;
  const signed = `POST /openapi/v2/order/create\napp-key.${headers["X-R-TS"]}.${request.options.body}`;
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(signed), ours.publicKey, Buffer.from(headers["X-R-Signature"], "base64")), "assinado com a nossa chave");
  assert.deepEqual(JSON.parse(request.options.body), { orderId: "tchilar-9", amount: "20.00", currency: "USD", redirectUrl: "https://tchilar.ao/estrelas" });

  // Webhook: assinado pela RedotPay → aceite; assinado por outra chave, alterado ou antigo → recusado.
  const body = JSON.stringify({ outerOrderSn: "tchilar-9", orderStatus: 2, orderAmount: "20.00", orderCurrency: "USD" });
  const now = Date.now();
  const sign = (key, ts, text = body) => crypto.sign("RSA-SHA256", Buffer.from(`app-key.${ts}.${text}`), key).toString("base64");
  const check = (signature, ts, text = body) => verifyRedotPayWebhook({ rawBody: text, headers: { "x-r-ts": String(ts), "x-r-signature": signature }, appKey: "app-key", platformPublicKey: pemOf(theirs.publicKey), now });
  assert.equal(check(sign(theirs.privateKey, now), now), true);
  assert.equal(check(sign(ours.privateKey, now), now), false, "assinatura de outra chave");
  assert.equal(check(sign(theirs.privateKey, now), now, body.replace("20.00", "0.01")), false, "corpo alterado");
  assert.equal(check(sign(theirs.privateKey, now - 10 * 60 * 1000), now - 10 * 60 * 1000), false, "aviso com mais de 5 minutos");
  assert.equal(signRedotPay({ method: "post", uri: "/x", appKey: "k", timestamp: "1", body: "{}", privateKey: pemOf(ours.privateKey) }).length > 100, true);
});
