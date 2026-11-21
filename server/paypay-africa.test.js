const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  createPayPayAfrica, encryptBizContent, signPayPay, verifyPayPaySignature, signString, angolaTimestamp,
  paypayState, tradeNoFor, paymentIdFromTradeNo
} = require("./paypay-africa");

// Chaves de teste geradas na hora (1024 bits, como pede a PayPay): a nossa e a "da PayPay".
const keyPair = () => crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
const ours = keyPair();
const theirs = keyPair();
const privatePem = ours.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
// Como no .env: só o Base64, sem cabeçalhos nem quebras de linha.
const privateBase64 = ours.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const theirPublicPem = theirs.publicKey.export({ type: "spki", format: "pem" }).toString();

// Decifra o biz_content como a PayPay faz: com a nossa chave PÚBLICA, aos pedaços de 128 bytes.
function decryptBizContent(base64) {
  const data = Buffer.from(base64, "base64");
  const parts = [];
  for (let offset = 0; offset < data.length; offset += 128) {
    parts.push(crypto.publicDecrypt({ key: ours.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, data.subarray(offset, offset + 128)));
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

test("PayPay: the sign string drops empty values and sign/sign_type and sorts keys", () => {
  assert.equal(signString({ service: "x", sign: "s", sign_type: "RSA", charset: "UTF-8", empty: "", partner_id: "1" }),
    "charset=UTF-8&partner_id=1&service=x");
});

test("PayPay: biz_content longer than one RSA block is encrypted in chunks and decrypts back", () => {
  const biz = { subject: "Estrelas para o criador".repeat(10), trade_info: { total_amount: "1500.00" } };
  const encrypted = encryptBizContent(biz, privateBase64);
  assert.equal(Buffer.from(encrypted, "base64").length % 128, 0);
  assert.deepEqual(decryptBizContent(encrypted), biz);
});

test("PayPay: notifications only count when signed with THEIR key", () => {
  const notice = { notify_type: "trade_status_sync", out_trade_no: "TCHILAR000042", status: "TRADE_FINISHED", amount: "1500.00", sign_type: "RSA" };
  notice.sign = signPayPay(notice, theirs.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  assert.equal(verifyPayPaySignature(notice, theirPublicPem), true);
  assert.equal(verifyPayPaySignature({ ...notice, amount: "1.00" }, theirPublicPem), false);
  const forged = { ...notice, sign: signPayPay(notice, privatePem) };
  assert.equal(verifyPayPaySignature(forged, theirPublicPem), false);
  assert.equal(verifyPayPaySignature({ ...notice, sign: "" }, theirPublicPem), false);
});

test("PayPay: timestamps are in Angola time and trade numbers round-trip", () => {
  assert.equal(angolaTimestamp(Date.UTC(2026, 10, 15, 23, 30, 5)), "2026-11-16 00:30:05");
  assert.equal(tradeNoFor(42), "TCHILAR000042");
  assert.equal(paymentIdFromTradeNo("TCHILAR000042"), 42);
  assert.equal(paymentIdFromTradeNo("OUTRO42"), null);
  assert.equal(paypayState("TRADE_SUCCESS"), "paid");
  assert.equal(paypayState("TRADE_FINISHED"), "paid");
  assert.equal(paypayState("TRADE_CLOSED"), "failed");
  assert.equal(paypayState("WAIT_BUYER_PAY"), "pending");
});

test("PayPay: instant_trade is signed, encrypted and returns the app link", async () => {
  const sent = [];
  const fetchImpl = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ code: "S0001", biz_content: { out_trade_no: "TCHILAR000042", trade_no: "T1", status: "P", trade_token: "tok en", dynamic_link: "https://paypay.link/abc" } }) };
  };
  const paypay = createPayPayAfrica({ partnerId: "200001835716", privateKey: privateBase64, paypayPublicKey: theirPublicPem, saleProductCode: "050200001", fetchImpl, now: () => Date.UTC(2026, 0, 1, 12) });
  const order = await paypay.createPayment({ paymentId: 42, amountKz: 1500, subject: "Estrelas", payerIp: "::ffff:41.63.1.2", returnUrl: "https://tchilar.ao/estrelas" });

  assert.equal(order.outTradeNo, "TCHILAR000042");
  assert.equal(order.deeplink, "paypayao://trade/pay?action=pay&tradeToken=tok%20en");
  assert.equal(order.dynamicLink, "https://paypay.link/abc");

  const { url, body } = sent[0];
  assert.equal(url, "https://gateway.paypayafrica.com/recv.do");
  const params = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, decodeURIComponent(value)]));
  assert.equal(params.service, "instant_trade");
  assert.equal(params.timestamp, "2026-01-01 13:00:00");
  // A assinatura confere com a nossa chave pública.
  assert.equal(crypto.verify("RSA-SHA1", Buffer.from(signString(params)), ours.publicKey, Buffer.from(params.sign, "base64")), true);
  const biz = decryptBizContent(params.biz_content);
  assert.equal(biz.payer_ip, "41.63.1.2");
  assert.equal(biz.sale_product_code, "050200001");
  assert.deepEqual(biz.trade_info, {
    currency: "AOA", out_trade_no: "TCHILAR000042", payee_identity: "200001835716", payee_identity_type: "1",
    price: "1500.00", quantity: "1", subject: "Estrelas", total_amount: "1500.00"
  });
});

test("PayPay: errors and trade_query states are reported", async () => {
  let reply = { code: "F0001", sub_code: "F31001", sub_msg: "invalid" };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => reply });
  const paypay = createPayPayAfrica({ partnerId: "1", privateKey: privatePem, saleProductCode: "x", fetchImpl });
  await assert.rejects(paypay.getState("TCHILAR000001"), /F31001/);
  reply = { code: "S0001", biz_content: JSON.stringify({ status: "TRADE_FINISHED", amount: "1500.00" }) };
  assert.deepEqual(await paypay.getState("TCHILAR000001"), { state: "paid", amount: 1500 });
});
