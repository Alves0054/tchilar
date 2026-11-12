const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PARTNER_RPM_KZ, PARTNER_RULES, partnerEarnings, partnerEligibility, pickPromotions, promotionWeight } = require("./promotions");

const ok = { followers: 10_000, views: 10_000, suspended: false, emailVerified: true };

test("partner programme requires 10k followers AND 10k views", () => {
  assert.equal(PARTNER_RULES.minFollowers, 10_000);
  assert.equal(PARTNER_RULES.minViews, 10_000);
  assert.equal(partnerEligibility(ok).eligible, true);
  assert.equal(partnerEligibility({ ...ok, followers: 9_999 }).eligible, false);
  assert.equal(partnerEligibility({ ...ok, views: 9_999 }).eligible, false);
  assert.equal(partnerEligibility({ ...ok, followers: 50_000, views: 0 }).eligible, false);
});

test("suspended accounts and unconfirmed emails cannot monetise", () => {
  assert.equal(partnerEligibility({ ...ok, suspended: true }).eligible, false);
  assert.equal(partnerEligibility({ ...ok, emailVerified: false }).eligible, false);
});

test("eligibility reports progress for each rule", () => {
  const { checks } = partnerEligibility({ ...ok, followers: 2_500 });
  const followers = checks.find(check => check.key === "followers");
  assert.deepEqual([followers.current, followers.target, followers.met], [2_500, 10_000, false]);
});

test("earnings are paid per thousand views", () => {
  assert.equal(partnerEarnings(1000), PARTNER_RPM_KZ);
  assert.equal(partnerEarnings(25_500), Math.round(25.5 * PARTNER_RPM_KZ * 100) / 100);
  assert.equal(partnerEarnings(-5), 0);
});

test("promotion weight is the remaining budget per remaining day", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  const endsAt = new Date("2026-11-22T00:00:00Z");
  assert.equal(promotionWeight({ budget: 10_000, spent: 0, endsAt }, now), 1_000);
  assert.equal(promotionWeight({ budget: 10_000, spent: 10_000, endsAt }, now), 0);
  assert.equal(promotionWeight({ budget: 10_000, spent: 0, endsAt: new Date("2026-11-11T00:00:00Z") }, now), 0);
  // Menos de um dia restante conta como um dia (não explode o peso).
  assert.equal(promotionWeight({ budget: 500, spent: 0, endsAt: new Date("2026-11-12T02:00:00Z") }, now), 500);
});

test("bigger daily budgets are picked more often, without repeats", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  const endsAt = "2026-11-22T00:00:00Z";
  const big = { id: 1, budget: 90_000, spent: 0, ends_at: endsAt };
  const small = { id: 2, budget: 10_000, spent: 0, ends_at: endsAt };
  const spentOut = { id: 3, budget: 10_000, spent: 10_000, ends_at: endsAt };
  let bigWins = 0;
  for (let i = 0; i < 1000; i++) {
    const [first] = pickPromotions([big, small, spentOut], 1, () => i / 1000, now);
    if (first.id === 1) bigWins++;
    assert.notEqual(first.id, 3);
  }
  assert.equal(bigWins, 900);
  const both = pickPromotions([big, small, spentOut], 5, Math.random, now);
  assert.deepEqual(both.map(ad => ad.id).sort(), [1, 2]);
});
