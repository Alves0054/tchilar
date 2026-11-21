-- PayPal e RedotPay nos pagamentos: os novos métodos, o valor cobrado na moeda do fornecedor (dólares)
-- e para onde a pessoa volta depois de pagar.
ALTER TABLE local_payments DROP CONSTRAINT IF EXISTS local_payments_method_check;
ALTER TABLE local_payments ADD CONSTRAINT local_payments_method_check CHECK (method IN ('express','reference','paypal','redotpay'));
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS charged_amount NUMERIC(12,2);
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS charged_currency VARCHAR(3);
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS success_path TEXT;
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS cancel_path TEXT;
