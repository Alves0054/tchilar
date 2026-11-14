const { test } = require("node:test");
const assert = require("node:assert/strict");
const { csvCell, parsePaymentFilters, paymentWhere, paymentsCsv, receiptNumber, serializePayment } = require("./payment-records");

test("receipt numbers are stable and say the kind and the year", () => {
  assert.equal(receiptNumber("stars", 12, "2026-03-04T10:00:00Z"), "BV-2026-E000012");
  assert.equal(receiptNumber("ad", 7, "2025-12-31T23:30:00Z"), "BV-2025-P000007");
  assert.equal(receiptNumber("group_access", 1234567, "2026-01-01T00:00:00Z"), "BV-2026-G1234567");
});

test("payment filters ignore unknown values instead of failing", () => {
  assert.deepEqual(parsePaymentFilters({}), { page: 1 });
  const filters = parsePaymentFilters({ kind: "stars", method: "express", status: "refunded", from: "2026-01-01", to: "2026-02-30x", q: "  ana  ", page: "3" });
  assert.deepEqual(filters, { kind: "stars", method: "express", status: "refunded", from: "2026-01-01", q: "ana", page: 3 });
  assert.deepEqual(parsePaymentFilters({ kind: "__proto__", method: "bitcoin", page: "-1" }), { page: 1 });
});

test("the search finds a payment by its receipt number", () => {
  const { where, params } = paymentWhere({ q: "bv-2026-e000012" });
  assert.match(where, /p\.kind=\$1 AND p\.ref_id=\$2/);
  assert.deepEqual(params, ["stars", 12]);
  const text = paymentWhere({ q: "@ana_50%" });
  assert.deepEqual(text.params, ["%ana\\_50\\%%"], "LIKE wildcards typed by the admin are escaped");
});

const row = {
  kind: "ad", ref_id: 3, user_id: 9, amount_kz: 15000, paid_at: "2026-05-01T08:00:00Z", description: "Promoção «=SUM(A1)» (7 dias)",
  status: "paid", card_ref: "pi_123", method: "reference", provider_ref: "123456789", entity: "11333", phone_last3: null,
  username: "ana", display_name: "Ana", email: "ana@example.test"
};

test("people see their reference but only the team sees email and technical ids", () => {
  const mine = serializePayment(row);
  assert.equal(mine.reference, "123456789");
  assert.equal(mine.entity, "11333");
  assert.equal(mine.customer.email, undefined);
  assert.equal(mine.provider_ref, undefined);
  const admin = serializePayment(row, { admin: true });
  assert.equal(admin.customer.email, "ana@example.test");
  assert.equal(admin.provider_ref, "123456789");
});

test("the CSV export is safe to open in Excel", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "\"'=HYPERLINK(1)\"");
  assert.equal(csvCell("diz \"olá\""), "\"diz \"\"olá\"\"\"");
  const csv = paymentsCsv([row]);
  assert.ok(csv.startsWith("﻿\"Recibo\";"));
  assert.match(csv, /"BV-2026-P000003";"2026-05-01 09:00";"Promoção"/, "dates are in Luanda time");
  assert.match(csv, /"15000\.00"/);
});
