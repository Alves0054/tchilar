ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_tier VARCHAR(16)
  CHECK (verification_tier IS NULL OR verification_tier IN ('kazola','bolado','benga'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS verification_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(16) NOT NULL CHECK (tier IN ('kazola','bolado','benga')),
  amount_kz INTEGER NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  stripe_payment_intent TEXT
);
CREATE INDEX IF NOT EXISTS verification_purchases_user_created_idx
  ON verification_purchases(user_id, created_at DESC);
