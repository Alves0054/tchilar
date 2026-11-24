const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ANGOLA_PROVINCES, STAR_PACKS, ageOn, campaignSplit, packPrice, parseBirthDate, parseTargeting, referralQualifies, starsValueKz
} = require("./growth");

test("star packs cost 10 Kz per star and creators keep 80%", () => {
  assert.equal(packPrice(STAR_PACKS[0]), 500);
  assert.equal(starsValueKz(100), 800);
  assert.equal(starsValueKz(1), 8);
});

test("brand campaigns keep a 15% commission for Tchilar", () => {
  assert.deepEqual(campaignSplit(100_000), { commission: 15_000, net: 85_000 });
  assert.deepEqual(campaignSplit(5_000), { commission: 750, net: 4_250 });
});

test("a referral only counts after email confirmation and a first post", () => {
  assert.equal(referralQualifies({ emailVerified: true, posts: 1 }), true);
  assert.equal(referralQualifies({ emailVerified: false, posts: 3 }), false);
  assert.equal(referralQualifies({ emailVerified: true, posts: 0 }), false);
});

test("targeting accepts Angolan provinces and sensible age ranges", () => {
  assert.equal(ANGOLA_PROVINCES.length, 21);
  assert.deepEqual(parseTargeting({ provinces: "Luanda, Benguela", minAge: "18", maxAge: "35" }).targeting,
    { provinces: ["Luanda", "Benguela"], minAge: 18, maxAge: 35, targeted: true });
  assert.equal(parseTargeting({}).targeting.targeted, false);
  for (const input of [{ provinces: ["Lisboa"] }, { minAge: 10 }, { minAge: 40, maxAge: 20 }, { maxAge: "abc" }]) {
    assert.ok(parseTargeting(input).error, JSON.stringify(input));
  }
});

test("birth dates are validated and give the age in full years", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  assert.equal(ageOn("2000-11-12", now), 26);
  assert.equal(ageOn("2000-11-13", now), 25);
  assert.equal(parseBirthDate("2000-02-30", now).error !== undefined, true);
  assert.equal(parseBirthDate("2020-01-01", now).error !== undefined, true);
  assert.deepEqual(parseBirthDate("1995-06-01", now), { value: "1995-06-01" });
  assert.deepEqual(parseBirthDate("", now), { value: null });
});
