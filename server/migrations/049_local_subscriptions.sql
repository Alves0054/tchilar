-- Subscrições pagas mês a mês por Multicaixa Express, Referência, PayPal ou RedotPay (sem Stripe).
-- Cada mês pago é uma linha aqui; o acesso continua em subscriptions (current_period_end), com provider='local'.
-- A pessoa renova à mão: 3 dias antes do fim recebe um aviso (renewal_reminded_at evita avisos repetidos).
CREATE TABLE IF NOT EXISTS subscription_payments (
  id SERIAL PRIMARY KEY,
  subscriber_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_kz NUMERIC(12,2) NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  period_end TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed')),
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscription_payments_creator_idx ON subscription_payments(creator_id) WHERE status='paid';
CREATE INDEX IF NOT EXISTS subscription_payments_subscriber_idx ON subscription_payments(subscriber_id, created_at DESC);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_reminded_at TIMESTAMPTZ;
