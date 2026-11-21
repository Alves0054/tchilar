const { test } = require("node:test");
const assert = require("node:assert/strict");
const { VERIFICATION_MIN_FOLLOWERS, VERIFICATION_PLANS, verificationEligibility } = require("./verification");

test("verification offers the three requested monthly plans", () => {
  assert.deepEqual(VERIFICATION_PLANS.map(({ id, name, priceKz, minFollowers, priority }) => [id, name, priceKz, minFollowers, priority]), [
    ["kazola", "Kazola", 5_000, 10_000, 0],
    ["bolado", "Bolado", 10_000, 15_000, 1],
    ["benga", "Benga", 20_000, 20_000, 2]
  ]);
});

test("higher verification plans provide progressively stronger marketplace placement", () => {
  assert.match(VERIFICATION_PLANS[1].benefits.join(" "), /prioridade elevada/i);
  assert.match(VERIFICATION_PLANS[2].benefits.join(" "), /Prioridade máxima/);
  assert.match(VERIFICATION_PLANS[2].benefits.join(" "), /distintivo dourado/i);
});

test("verification eligibility uses the follower threshold for the selected plan", () => {
  assert.equal(VERIFICATION_MIN_FOLLOWERS, 10_000);
  assert.equal(verificationEligibility(9_999, "kazola"), false);
  assert.equal(verificationEligibility(10_000, "kazola"), true);
  assert.equal(verificationEligibility(14_999, "bolado"), false);
  assert.equal(verificationEligibility(15_000, "bolado"), true);
  assert.equal(verificationEligibility(19_999, "benga"), false);
  assert.equal(verificationEligibility(20_000, "benga"), true);
  assert.equal(verificationEligibility(50_000, "unknown"), false);
  assert.equal(verificationEligibility(Number.NaN, "benga"), false);
});
