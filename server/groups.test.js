const { test } = require("node:test");
const assert = require("node:assert/strict");
const { groupAccessValueKz, isAdult, parseAccessPrice, sameGroupName } = require("./groups");

test("adult means 18 completed years, counted on the birthday itself", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  assert.equal(isAdult("2008-11-13", now), true, "faz 18 hoje");
  assert.equal(isAdult("2008-11-14", now), false, "faz 18 amanhã");
  assert.equal(isAdult(null, now), false, "sem data conta como menor");
});

test("secret group names match exactly, ignoring case and outer spaces", () => {
  assert.equal(sameGroupName("  clube NOTURNO ", "Clube Noturno"), true);
  assert.equal(sameGroupName("Clube", "Clube Noturno"), false);
  assert.equal(sameGroupName(undefined, "Clube"), false);
});

test("entry price uses the same limits as subscriptions and the owner keeps 70%", () => {
  assert.equal(parseAccessPrice(2500).value, 2500);
  assert.ok(parseAccessPrice(10).error);
  assert.ok(parseAccessPrice("abc").error);
  assert.equal(groupAccessValueKz(2500), 1750);
});
