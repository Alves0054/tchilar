const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapStripeStatus, parseSubscriptionPrice, periodEndFromStripe } = require("./subscriptions");

test("subscription prices accept euros with up to two decimals", () => {
  assert.equal(parseSubscriptionPrice(4.99), 4.99);
  assert.equal(parseSubscriptionPrice("9.99"), 9.99);
  assert.equal(parseSubscriptionPrice(1), 1);
  assert.equal(parseSubscriptionPrice(1000), 1000);
  for (const invalid of [0, 0.5, 1000.01, 4.999, NaN, Infinity, "", "abc", null, undefined, true]) {
    assert.equal(parseSubscriptionPrice(invalid), null, String(invalid));
  }
});

test("period end is read from subscription items with a legacy fallback", () => {
  assert.equal(periodEndFromStripe({ items: { data: [{ current_period_end: 1700000000 }] } }).getTime(), 1700000000000);
  assert.equal(periodEndFromStripe({ current_period_end: 1600000000 }).getTime(), 1600000000000);
  assert.equal(periodEndFromStripe({}), null);
});

test("only paid Stripe states grant access", () => {
  assert.equal(mapStripeStatus("active"), "active");
  for (const status of ["incomplete", "incomplete_expired", "unpaid", "canceled"]) {
    assert.equal(mapStripeStatus(status), "canceled", status);
  }
});
