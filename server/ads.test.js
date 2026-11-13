const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AD_CPM_KZ, MAX_AD_DAYS, MIN_AD_BUDGET, groupAudience, impressionCost, parseAdInput } = require("./ads");

const valid = { title: "  Loja   da Rita ", body: "Promoção", budget: "5000", days: 7 };

test("an impression costs the CPM divided by a thousand", () => {
  assert.equal(impressionCost(), Math.round((AD_CPM_KZ / 1000) * 100) / 100);
});

test("ads default to the advertiser profile and normalise text", () => {
  const { ad } = parseAdInput(valid, "rita");
  assert.deepEqual(ad, { title: "Loja da Rita", body: "Promoção", linkUrl: "/u/rita", budget: 5000, days: 7 });
});

test("external ad links must be https", () => {
  assert.equal(parseAdInput({ ...valid, destination: "link", linkUrl: "https://exemplo.ao/loja" }, "rita").ad.linkUrl, "https://exemplo.ao/loja");
  for (const linkUrl of ["http://exemplo.ao", "javascript:alert(1)", "não é um endereço", ""]) {
    assert.ok(parseAdInput({ ...valid, destination: "link", linkUrl }, "rita").error, linkUrl);
  }
});

test("budget, duration, title and destination are validated", () => {
  for (const input of [
    { ...valid, budget: MIN_AD_BUDGET - 1 },
    { ...valid, budget: "abc" },
    { ...valid, days: 0 },
    { ...valid, days: MAX_AD_DAYS + 1 },
    { ...valid, days: 2.5 },
    { ...valid, title: "" },
    { ...valid, title: "x".repeat(81) },
    { ...valid, body: "x".repeat(201) },
    { ...valid, destination: "mars" }
  ]) {
    assert.ok(parseAdInput(input, "rita").error, JSON.stringify(input).slice(0, 80));
  }
});

test("small audience groups are folded into «Outras» so nobody is identifiable", () => {
  const rows = [
    { province: "Luanda", people: 40 }, { province: "Huambo", people: 4 }, { province: "Benguela", people: 12 },
    { province: null, people: 3 }, { province: "Namibe", people: 5 }
  ];
  assert.deepEqual(groupAudience(rows), [
    { province: "Luanda", people: 40 }, { province: "Benguela", people: 12 }, { province: "Namibe", people: 5 }, { province: null, people: 7 }
  ]);
  assert.deepEqual(groupAudience([]), []);
  assert.deepEqual(groupAudience([{ province: "Luanda", people: 2 }]), [{ province: null, people: 2 }]);
});
