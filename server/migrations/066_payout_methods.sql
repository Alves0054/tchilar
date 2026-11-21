-- Levantamentos por mais do que transferência bancária: Multicaixa Express, PayPay África, PayPal e RedotPay.
-- As colunas iban_encrypted/iban_last4 passam a guardar o destino de qualquer método (IBAN, telemóvel, email ou
-- ID RedotPay), sempre cifrado; destination_hint é a versão mascarada para mostrar (ex.: "•••• 1234", "an•••@gmail.com").
ALTER TABLE payout_accounts ADD COLUMN IF NOT EXISTS method VARCHAR(12) NOT NULL DEFAULT 'iban'
  CHECK (method IN ('iban','express','paypay','paypal','redotpay'));
ALTER TABLE payout_accounts ADD COLUMN IF NOT EXISTS destination_hint VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS method VARCHAR(12) NOT NULL DEFAULT 'iban'
  CHECK (method IN ('iban','express','paypay','paypal','redotpay'));
ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS destination_hint VARCHAR(80) NOT NULL DEFAULT '';
