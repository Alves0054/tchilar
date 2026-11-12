-- Pagamentos por Multicaixa Express (Paybyrd) e por Referência (ProxyPay).
-- Cada linha é um pedido de pagamento; fica "paid" uma única vez, quando o pagamento é confirmado.
CREATE TABLE IF NOT EXISTS local_payments (
  id SERIAL PRIMARY KEY,
  purpose VARCHAR(20) NOT NULL,
  ref_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method VARCHAR(12) NOT NULL CHECK (method IN ('express','reference')),
  amount_kz NUMERIC(12,2) NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','expired')),
  provider_ref TEXT NOT NULL,
  entity VARCHAR(10),
  phone_last3 VARCHAR(3),
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (method, provider_ref)
);
CREATE INDEX IF NOT EXISTS local_payments_user_idx ON local_payments(user_id, created_at DESC);
