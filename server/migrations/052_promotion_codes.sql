CREATE TABLE IF NOT EXISTS promotion_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) UNIQUE NOT NULL,
  discount_percent SMALLINT NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  min_amount_kz NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_discount_kz NUMERIC(12,2),
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ,
  applicable_purposes TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotion_code_uses (
  id SERIAL PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES promotion_codes(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purpose VARCHAR(30) NOT NULL,
  ref_id INTEGER,
  original_amount_kz NUMERIC(12,2) NOT NULL,
  discount_amount_kz NUMERIC(12,2) NOT NULL,
  paid_amount_kz NUMERIC(12,2) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code_id,purpose,ref_id)
);

ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES promotion_codes(id) ON DELETE SET NULL;
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS promo_original_amount NUMERIC(12,2);
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(12,2);
ALTER TABLE local_payments ADD COLUMN IF NOT EXISTS promo_paid_amount NUMERIC(12,2);
