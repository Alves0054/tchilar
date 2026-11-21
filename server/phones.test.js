const test = require("node:test");
const assert = require("node:assert/strict");
const { PHONE_COUNTRIES, angolanNational, parsePhoneNumber } = require("./phones");

test("every CPLP country accepts its own example mobile number, with and without the dial code", () => {
  for (const country of PHONE_COUNTRIES) {
    const national = country.example.replace(/\s/g, "");
    const local = parsePhoneNumber(country.example, country.code);
    assert.equal(local?.e164, `+${country.dial}${national}`, `${country.name}: número nacional`);
    assert.equal(parsePhoneNumber(`+${country.dial} ${country.example}`)?.country, country.code, `${country.name}: com indicativo`);
    assert.equal(parsePhoneNumber(`00${country.dial}${national}`)?.e164, local.e164, `${country.name}: com 00`);
  }
});

test("Angola is the default and the stored format reads back the same", () => {
  assert.deepEqual(parsePhoneNumber("923 456 789"), { e164: "+244923456789", country: "AO" });
  assert.deepEqual(parsePhoneNumber("+244923456789"), { e164: "+244923456789", country: "AO" });
  assert.equal(parsePhoneNumber("(+244) 923-456-789")?.e164, "+244923456789");
});

test("landlines, other countries and junk are refused", () => {
  assert.equal(parsePhoneNumber("222 123 456"), null, "fixo angolano");
  assert.equal(parsePhoneNumber("+351 212 345 678"), null, "fixo português");
  assert.equal(parsePhoneNumber("+33 612 345 678"), null, "França");
  assert.equal(parsePhoneNumber("+1 202 555 0143"), null, "EUA");
  assert.equal(parsePhoneNumber("abc"), null);
  assert.equal(parsePhoneNumber(""), null);
  assert.equal(parsePhoneNumber(/** @type {any} */ (923456789)), null, "só texto");
});

test("Brazil: area code plus a 9-digit mobile, with or without the leading zero", () => {
  assert.equal(parsePhoneNumber("11 91234-5678", "BR")?.e164, "+5511912345678");
  assert.equal(parsePhoneNumber("011 91234 5678", "BR")?.e164, "+5511912345678");
  assert.equal(parsePhoneNumber("11 3123-4567", "BR"), null, "fixo");
});

test("only Angolan numbers prefill Multicaixa Express", () => {
  assert.equal(angolanNational("+244923456789"), "923456789");
  assert.equal(angolanNational("+351912345678"), null);
  assert.equal(angolanNational(null), null);
});
