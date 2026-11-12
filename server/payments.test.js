const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPayments } = require("./payments");

test("without Stripe, payments fail closed outside development", async () => {
  // isProduction=true significa "não é NODE_ENV=development" (produção, staging ou variável esquecida).
  const payments = createPayments({ stripe: null, isProduction: true, appUrl: "http://localhost", currency: "aoa" });
  let fulfilled = false;
  payments.register("ad", () => { fulfilled = true; });
  assert.equal(payments.mode, "off");
  const result = await payments.start({ purpose: "ad", refId: 1, amountKz: 1000, successPath: "/", cancelPath: "/" });
  assert.ok(result.error);
  assert.equal(fulfilled, false);
  assert.deepEqual(await payments.refund({ paymentIntent: null }), { status: "manual" });
});

test("demo payments only exist in development and never call Stripe", async () => {
  const payments = createPayments({ stripe: null, isProduction: false, appUrl: "http://localhost", currency: "aoa" });
  let details = null;
  payments.register("stars", (_id, received) => { details = received; });
  assert.equal(payments.mode, "demo");
  assert.deepEqual(await payments.start({ purpose: "stars", refId: 7, amountKz: 500, successPath: "/", cancelPath: "/" }), { activated: true, demo: true });
  assert.deepEqual(details, { demo: true });
});

test("only paid Stripe checkouts fulfil, with the payment intent for refunds", async () => {
  const payments = createPayments({ stripe: {}, isProduction: true, appUrl: "http://localhost", currency: "aoa" });
  const seen = [];
  payments.register("campaign", (id, received) => seen.push([id, received.paymentIntent]));
  assert.equal(await payments.handleCheckoutSession({ mode: "payment", payment_status: "unpaid", metadata: { purpose: "campaign", ref_id: "3" } }), false);
  assert.equal(await payments.handleCheckoutSession({ mode: "payment", payment_status: "paid", payment_intent: "pi_123", metadata: { purpose: "campaign", ref_id: "3" } }), true);
  assert.equal(await payments.handleCheckoutSession({ mode: "payment", payment_status: "paid", metadata: { purpose: "desconhecido", ref_id: "3" } }), false);
  assert.deepEqual(seen, [[3, "pi_123"]]);
});

test("reference payments can only be simulated with demo payments enabled", async () => {
  let mocked = 0;
  const pool = { query: async () => ({ rowCount: 1, rows: [{ provider_ref: "123", amount_kz: 500 }] }) };
  const proxypay = { environment: "sandbox", entityId: "411", mockPayment: async () => { mocked += 1; } };
  const locked = createPayments({ stripe: null, isProduction: true, appUrl: "http://x", currency: "aoa", pool, proxypay });
  assert.equal(await locked.simulateReference(1, 1), false);
  assert.equal(mocked, 0);
  const demo = createPayments({ stripe: null, isProduction: false, appUrl: "http://x", currency: "aoa", pool, proxypay, allowSimulation: true });
  demo.pollProxyPay = async () => {};
  assert.equal(await demo.simulateReference(1, 1), true);
  assert.equal(mocked, 1);
});
