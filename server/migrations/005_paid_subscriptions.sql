-- Subscrições pagas: o acesso passa a depender de um período pago e não apenas de status='active'.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'demo';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR(255);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_idx
  ON subscriptions(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_creator_idx ON subscriptions(creator_id);

-- As subscrições antigas foram criadas sem pagamento: passam a ser demonstrações de 30 dias.
UPDATE subscriptions
SET current_period_end = NOW() + INTERVAL '30 days'
WHERE status = 'active' AND current_period_end IS NULL;

-- O registo enviava 1500 como preço por omissão para todas as contas.
UPDATE users SET subscription_price = 0 WHERE is_creator = FALSE;
