const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canRenewGroupAccess, groupAccessValueKz, isAdult, parseAccessBilling, parseAccessPrice, sameGroupName } = require("./groups");

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

test("one-time entry goes up to 50 000 Kz, monthly up to 20 000 Kz, and the owner keeps 80%", () => {
  assert.equal(parseAccessPrice(2500).value, 2500);
  assert.equal(parseAccessPrice(50000).value, 50000);
  assert.ok(parseAccessPrice(50001).error, "entrada única: no máximo 50 000 Kz");
  assert.equal(parseAccessPrice(20000, "monthly").value, 20000);
  assert.ok(parseAccessPrice(20001, "monthly").error, "mensal: no máximo 20 000 Kz");
  assert.match(parseAccessPrice(30000, "monthly").error, /mensalidade/i);
  assert.ok(parseAccessPrice(10).error);
  assert.ok(parseAccessPrice("abc").error);
  assert.equal(groupAccessValueKz(2500), 2000);
  assert.deepEqual(parseAccessBilling(undefined), { value: "once" });
  assert.deepEqual(parseAccessBilling("monthly"), { value: "monthly" });
  assert.ok(parseAccessBilling("yearly").error);
});

test("a monthly member can renew only in the last 7 days of access", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const inDays = days => new Date(now.getTime() + days * 86_400_000);
  assert.equal(canRenewGroupAccess(inDays(5), now), true);
  assert.equal(canRenewGroupAccess(inDays(20), now), false, "ainda falta muito");
  assert.equal(canRenewGroupAccess(inDays(-1), now), false, "já acabou: volta a entrar como novo");
  assert.equal(canRenewGroupAccess(null, now), false, "entrada única não tem fim");
});
