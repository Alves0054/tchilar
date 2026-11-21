function normalizePromotionCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40) : "";
}

function discountedAmount(row, amountKz) {
  const amount = Number(amountKz);
  const percent = Number(row.discount_percent);
  let discount = Math.round(amount * percent) / 100;
  discount = Math.round(discount * 100) / 100;
  if (row.max_discount_kz != null) discount = Math.min(discount, Number(row.max_discount_kz));
  discount = Math.min(discount, amount);
  return {
    original: Math.round(amount * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    paid: Math.max(1, Math.round((amount - discount) * 100) / 100)
  };
}

/**
 * @typedef {{ ok: true, code: any, amount: number, original: number, discount: number, paid: number }} PromotionResult
 * @typedef {{ ok: false, error: string }} PromotionError
 * @returns {Promise<PromotionResult | PromotionError>}
 */
async function resolvePromotionCode(pool, { code, purpose, amountKz, userId }) {
  const normalized = normalizePromotionCode(code);
  const original = Math.round(Number(amountKz) * 100) / 100;
  if (!normalized) return { ok: true, code: null, amount: original, original, discount: 0, paid: original };
  // O limite de usos conta os pagamentos já confirmados (used_count) e os que estão a decorrer com este código
  // (pedido Express ou referência por pagar, ainda válidos), menos os da própria pessoa (pode tentar outra vez).
  // Assim, 10 pessoas a pagar ao mesmo tempo não gastam um código de 5 usos 10 vezes.
  const found = await pool.query(`
    SELECT * FROM promotion_codes c
    WHERE c.code=$1 AND c.active=TRUE
      AND (c.expires_at IS NULL OR c.expires_at > NOW())
      AND (c.max_uses IS NULL OR c.used_count + (
        SELECT COUNT(*) FROM local_payments lp
        WHERE lp.promo_code_id=c.id AND lp.status='pending' AND (lp.expires_at IS NULL OR lp.expires_at > NOW())
          AND lp.user_id IS DISTINCT FROM $4
      ) < c.max_uses)
      AND (cardinality(c.applicable_purposes)=0 OR $2=ANY(c.applicable_purposes))
      AND c.min_amount_kz <= $3`, [normalized, purpose, amountKz, userId || null]);
  const row = found.rows[0];
  if (!row) return { ok: false, error: "Este código promocional é inválido, expirou ou não se aplica a esta compra." };
  const values = discountedAmount(row, amountKz);
  return { ok: true, code: row, amount: values.paid, ...values };
}

// Regista o uso (uma vez por compra) e soma-o ao contador, numa só instrução: atómico sem precisar de transação
// (com um Pool, BEGIN e COMMIT em pool.query podiam ir para ligações diferentes e não protegiam nada).
async function recordPromotionCodeUse(pool, { codeId, userId, purpose, refId, originalAmount, discountAmount, paidAmount }) {
  if (!codeId) return;
  await pool.query(`
    WITH used AS (
      INSERT INTO promotion_code_uses(code_id,user_id,purpose,ref_id,original_amount_kz,discount_amount_kz,paid_amount_kz)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (code_id,purpose,ref_id) DO NOTHING
      RETURNING code_id
    )
    UPDATE promotion_codes SET used_count=used_count+1 WHERE id IN (SELECT code_id FROM used)`,
  [codeId, userId || null, purpose, refId, originalAmount, discountAmount, paidAmount]);
}

module.exports = { discountedAmount, normalizePromotionCode, recordPromotionCodeUse, resolvePromotionCode };
