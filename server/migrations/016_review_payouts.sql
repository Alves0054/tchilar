-- Promoções: depois de pagas ficam em revisão; um administrador aprova ou recusa (com reembolso).
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_status_check;
ALTER TABLE ads ADD CONSTRAINT ads_status_check
  CHECK (status IN ('pending_payment','in_review','active','paused','ended','rejected'));
ALTER TABLE ads ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS review_note VARCHAR(300) NOT NULL DEFAULT '';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed'));

ALTER TABLE star_purchases ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE brand_campaigns ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;

-- Conta para receber pagamentos (IBAN guardado cifrado; só os 4 últimos dígitos em claro).
CREATE TABLE IF NOT EXISTS payout_accounts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  holder_name VARCHAR(120) NOT NULL,
  bank_name VARCHAR(80) NOT NULL,
  iban_encrypted TEXT NOT NULL,
  iban_last4 VARCHAR(4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos de levantamento. Ficam guardados mesmo que a conta seja apagada (registos contabilísticos):
-- o titular e o IBAN cifrado são copiados no momento do pedido.
CREATE TABLE IF NOT EXISTS payout_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  holder_name VARCHAR(120) NOT NULL,
  bank_name VARCHAR(80) NOT NULL,
  iban_encrypted TEXT NOT NULL,
  iban_last4 VARCHAR(4) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','rejected')),
  reference VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(300) NOT NULL DEFAULT '',
  processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payout_requests_user_idx ON payout_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payout_requests_status_idx ON payout_requests(status, created_at);
