const { test } = require("node:test");
const assert = require("node:assert/strict");
const { base32Decode, base32Encode, codeAt, generateSecret, otpauthUri, verifyCode } = require("./totp");

// Segredo do RFC 6238 (anexo B): "12345678901234567890" em ASCII.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 encode/decode round-trips", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.equal(base32Encode(Buffer.from("12345678901234567890")), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("codeAt matches the RFC 6238 SHA1 test vectors", () => {
  // T=59s → passo 1 → 94287082 (8 dígitos); T=1111111109 → 07081804.
  assert.equal(codeAt(RFC_SECRET, 1, 8), "94287082");
  assert.equal(codeAt(RFC_SECRET, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(codeAt(RFC_SECRET, 1), "287082");
});

test("verifyCode accepts the current and neighbouring steps only", () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30000);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step), { now }), step);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), { now }), step - 1);
  assert.equal(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 3), { now }), null);
  assert.equal(verifyCode(RFC_SECRET, "12a456", { now }), null);
  assert.equal(verifyCode(RFC_SECRET, "", { now }), null);
});

test("verifyCode refuses a code that was already used", () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30000);
  const code = codeAt(RFC_SECRET, step);
  assert.equal(verifyCode(RFC_SECRET, code, { now, lastStep: step }), null);
  assert.equal(verifyCode(RFC_SECRET, code, { now, lastStep: step - 1 }), step);
});

test("generated secrets are 160-bit base32 and build an otpauth URI", () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const uri = otpauthUri({ secret, account: "ana" });
  assert.ok(uri.startsWith("otpauth://totp/Tchilar%3Aana?"));
  assert.ok(uri.includes(`secret=${secret}`));
});
