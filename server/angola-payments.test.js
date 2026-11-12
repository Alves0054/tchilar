const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createPaybyrd, createProxyPay, normalizeAngolanPhone, paybyrdState, verifyProxyPaySignature } = require("./angola-payments");
const { createPayments } = require("./payments");

// fetch falso que regista os pedidos e devolve respostas pré-definidas.
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
    const next = responses.shift();
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? "")
    };
  };
  return { impl, calls };
}

test("Angolan mobile numbers are normalised to 9 digits starting with 9", () => {
  assert.equal(normalizeAngolanPhone("923 456 789"), "923456789");
  assert.equal(normalizeAngolanPhone("+244 923456789"), "923456789");
  assert.equal(normalizeAngolanPhone("00244923456789"), "923456789");
  for (const invalid of ["823456789", "92345678", "9234567890", "", null, "abc"]) assert.equal(normalizeAngolanPhone(invalid), null, String(invalid));
});

test("ProxyPay webhooks are accepted only with the HMAC-SHA-256 signature of the raw body", () => {
  const body = Buffer.from('{"reference_id":123,"amount":"1000.00"}');
  const good = crypto.createHmac("sha256", "chave").update(body).digest("hex");
  assert.equal(verifyProxyPaySignature(body, good, "chave"), true);
  assert.equal(verifyProxyPaySignature(body, good.toUpperCase(), "chave"), true);
  assert.equal(verifyProxyPaySignature(body, good, "outra"), false);
  assert.equal(verifyProxyPaySignature(Buffer.from('{"reference_id":123,"amount":"1.00"}'), good, "chave"), false);
  assert.equal(verifyProxyPaySignature(body, "", "chave"), false);
});

test("ProxyPay references are created with the v2 headers, a generated id and the amount", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: 475545250 }, { status: 204 }]);
  const proxypay = createProxyPay({ apiKey: "k", entityId: 411, fetchImpl: impl });
  const reference = await proxypay.createReference({ amountKz: 2500, endDate: "2026-11-15", customFields: { purpose: "stars", ref_id: 7 } });
  assert.equal(reference, "475545250");
  assert.equal(calls[0].url, "https://api.sandbox.proxypay.co.ao/reference_ids");
  assert.equal(calls[0].headers.Authorization, "Token k");
  assert.equal(calls[0].headers.Accept, "application/vnd.proxypay.v2+json");
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].url, "https://api.sandbox.proxypay.co.ao/references/475545250");
  assert.deepEqual(calls[1].body, { amount: "2500.00", end_datetime: "2026-11-15", custom_fields: { purpose: "stars", ref_id: "7" } });
});

test("Multicaixa Express payments are sent to Paybyrd with the phone number and AOA", async () => {
  const { impl, calls } = fakeFetch([{ status: 201, body: { transactionId: "t-1", status: "Processing", multicaixaExpress: { qrCodeUrl: "https://qr", deeplinkRedirect: "https://dl", expiresAt: "2026-11-12T10:00:00Z" } } }]);
  const paybyrd = createPaybyrd({ apiKey: "pk", fetchImpl: impl });
  const created = await paybyrd.createExpressPayment({ amountKz: 5000, phone: "923456789", orderRef: "biva-1" });
  assert.deepEqual(created, { transactionId: "t-1", state: "pending", qrCodeUrl: "https://qr", deeplink: "https://dl", expiresAt: "2026-11-12T10:00:00Z" });
  assert.equal(calls[0].url, "https://gateway.paybyrd.com/api/v2/payment");
  assert.equal(calls[0].headers["x-api-key"], "pk");
  assert.equal(calls[0].body.brand, "MULTICAIXAEXPRESS");
  assert.equal(calls[0].body.currency, "AOA");
  assert.equal(calls[0].body.isoAmount, 500000);
  assert.equal(calls[0].body.phoneNumber, "244#923456789");
});

test("Paybyrd statuses map to paid, failed or still pending", () => {
  assert.equal(paybyrdState({ status: "Success" }), "paid");
  assert.equal(paybyrdState({ status: "Processing" }), "pending");
  assert.equal(paybyrdState({ status: "Canceled" }), "failed");
  assert.equal(paybyrdState({ status: "Expired" }), "failed");
  assert.equal(paybyrdState({}), "pending");
});

// Base de dados falsa só com o necessário para os pagamentos locais.
function fakePool(rows) {
  return {
    rows,
    async query(sql, values) {
      if (sql.startsWith("SELECT id, amount_kz::float AS amount FROM local_payments")) {
        return { rows: rows.filter(row => row.method === "reference" && row.provider_ref === values[0]).map(row => ({ id: row.id, amount: row.amount_kz })) };
      }
      if (sql.startsWith("UPDATE local_payments SET status='paid'")) {
        const row = rows.find(item => item.id === values[0] && item.status === "pending");
        if (!row) return { rowCount: 0, rows: [] };
        row.status = "paid";
        return { rowCount: 1, rows: [{ purpose: row.purpose, ref_id: row.ref_id, method: row.method }] };
      }
      throw new Error(`SQL inesperado: ${sql.slice(0, 60)}`);
    }
  };
}

test("a reference is settled once, only when the full amount is paid", async () => {
  const pool = fakePool([{ id: 1, purpose: "stars", ref_id: 9, method: "reference", provider_ref: "555", amount_kz: 1000, status: "pending" }]);
  const payments = createPayments({ stripe: null, isProduction: true, appUrl: "http://x", currency: "aoa", pool, proxypay: { entityId: "411" } });
  const delivered = [];
  payments.register("stars", id => delivered.push(id));
  assert.equal(await payments.handleProxyPayPayment({ reference_id: 555, amount: "999.00" }), "underpaid");
  assert.deepEqual(delivered, []);
  assert.equal(await payments.handleProxyPayPayment({ reference_id: 555, amount: "1000.00" }), "settled");
  assert.equal(await payments.handleProxyPayPayment({ reference_id: 555, amount: "1000.00" }), "settled");
  assert.deepEqual(delivered, [9]);
  assert.equal(await payments.handleProxyPayPayment({ reference_id: 999, amount: "1000.00" }), "unknown");
});

test("with several methods configured, the customer has to choose one", async () => {
  const payments = createPayments({ stripe: {}, isProduction: true, appUrl: "http://x", currency: "aoa", pool: {}, proxypay: { entityId: "411" }, paybyrd: {} });
  assert.deepEqual(payments.methods, ["express", "reference", "card"]);
  const result = await payments.start({ purpose: "stars", refId: 1, amountKz: 500 });
  assert.match(result.error, /método/);
  const badPhone = await payments.start({ purpose: "stars", refId: 1, amountKz: 500, method: "express", phone: "123" });
  assert.match(badPhone.error, /telemóvel/);
});
