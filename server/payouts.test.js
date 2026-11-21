const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { MIN_WITHDRAWAL_KZ, decrypt, encrypt, isValidAngolanIban, loadKey, maskIban, parseWithdrawal, payoutBalance } = require("./payouts");

// IBAN fictício com dígitos de controlo corretos, calculado aqui (não pertence a ninguém).
function syntheticIban(bban) {
  const digits = (bban + "AO00").replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return `AO${String(98 - remainder).padStart(2, "0")}${bban}`;
}

test("Angolan IBANs are validated by length, prefix and mod 97", () => {
  const iban = syntheticIban("000000000000000000001");
  assert.equal(isValidAngolanIban(iban), true);
  assert.equal(isValidAngolanIban(iban.replace(/(.{4})/g, "$1 ")), true);
  assert.equal(isValidAngolanIban(iban.slice(0, -1) + (iban.endsWith("1") ? "2" : "1")), false);
  assert.equal(isValidAngolanIban("PT50000000000000000000000"), false);
  assert.equal(isValidAngolanIban("AO06123"), false);
  assert.equal(maskIban("1234"), "•••• 1234");
});

test("bank details are encrypted with AES-256-GCM and tampering is detected", () => {
  const key = loadKey({ payoutKey: crypto.randomBytes(32).toString("hex") });
  const sealed = encrypt(key, "AO06 TESTE");
  assert.notEqual(sealed.includes("AO06"), true);
  assert.equal(decrypt(key, sealed), "AO06 TESTE");
  const parts = sealed.split(".");
  parts[3] = Buffer.from("outro").toString("base64");
  assert.throws(() => decrypt(key, parts.join(".")));
});

test("production refuses to run without an explicit payout key", () => {
  assert.equal(loadKey({ isProduction: true, jwtSecret: "x" }), null);
  assert.equal(loadKey({ isProduction: false, jwtSecret: "x" }).length, 32);
  assert.throws(() => loadKey({ payoutKey: "curta" }));
});

test("balance subtracts withdrawals and withdrawals respect the minimum", () => {
  assert.deepEqual(payoutBalance({ partnerKz: 4000, starsKz: 700, campaignsKz: 68000, withdrawnKz: 10000 }), { earned: 72700, available: 62700 });
  assert.equal(payoutBalance({ starsKz: 100, withdrawnKz: 500 }).available, 0);
  assert.deepEqual(parseWithdrawal("6000", 10000), { amount: 6000 });
  assert.ok(parseWithdrawal(MIN_WITHDRAWAL_KZ - 1, 10000).error);
  assert.ok(parseWithdrawal(20000, 10000).error);
  assert.ok(parseWithdrawal("abc", 10000).error);
});

test("payout destinations: bank, Express, PayPay, PayPal and RedotPay", () => {
  const { PAYOUT_METHODS, parsePayoutDestination } = require("./payouts");
  assert.deepEqual(Object.keys(PAYOUT_METHODS), ["iban", "express", "paypay", "paypal", "redotpay"]);
  const iban = syntheticIban("000600000123456789012");
  assert.equal(parsePayoutDestination("iban", iban).value, iban);
  assert.ok(parsePayoutDestination("iban", "AO06123").error);
  // Express e PayPay: só números angolanos, com ou sem indicativo.
  for (const method of ["express", "paypay"]) {
    assert.equal(parsePayoutDestination(method, "923 456 789").value, "+244923456789");
    assert.equal(parsePayoutDestination(method, "+244 923456789").value, "+244923456789");
    assert.ok(parsePayoutDestination(method, "+351912345678").error, "a Portuguese number cannot receive Express/PayPay");
    assert.ok(!parsePayoutDestination(method, "923456789").hint.includes("923456789"), "the hint must not show the full number");
  }
  const paypal = parsePayoutDestination("paypal", " Ana.Silva@Example.com ");
  assert.equal(paypal.value, "ana.silva@example.com");
  assert.equal(paypal.hint, "an•••@example.com");
  assert.ok(parsePayoutDestination("paypal", "ana@").error);
  assert.equal(parsePayoutDestination("redotpay", "12345678").hint, "ID •••• 5678");
  assert.equal(parsePayoutDestination("redotpay", "ana@example.com").value, "ana@example.com");
  assert.ok(parsePayoutDestination("redotpay", "abc").error);
  assert.ok(parsePayoutDestination("bitcoin", "x").error);
});
