-- Grupos secretos: só para maiores de 18, com entrada paga, e só se encontram pelo nome exato.
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS is_secret BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS access_price NUMERIC(12,2);
ALTER TABLE social_groups DROP CONSTRAINT IF EXISTS social_groups_secret_price_check;
ALTER TABLE social_groups ADD CONSTRAINT social_groups_secret_price_check
  CHECK ((is_secret AND access_price > 0) OR (NOT is_secret AND access_price IS NULL));
-- Procura pelo nome exato, sem distinguir maiúsculas.
CREATE INDEX IF NOT EXISTS social_groups_secret_name_idx ON social_groups(lower(name)) WHERE is_secret;

-- Entradas pagas. O valor e o dono ficam guardados no momento da compra: se o grupo for apagado,
-- o que o dono já ganhou não desaparece dos ganhos (nem dos levantamentos já feitos).
CREATE TABLE IF NOT EXISTS group_access_purchases (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES social_groups(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_kz NUMERIC(12,2) NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_access_purchases_owner_idx ON group_access_purchases(owner_id) WHERE status='paid';
CREATE INDEX IF NOT EXISTS group_access_purchases_user_idx ON group_access_purchases(user_id, group_id);
