-- Público: província e data de nascimento (opcionais), usadas só para promoções segmentadas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS province VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Convites: quem trouxe esta pessoa e quando foi dado o prémio.
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON users(referred_by) WHERE referred_by IS NOT NULL;

-- Segmentação das promoções.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_provinces TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_min_age SMALLINT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_max_age SMALLINT;

-- Estrelas: livro-razão. O saldo é a soma dos movimentos (positivo entra, negativo sai).
CREATE TABLE IF NOT EXISTS star_ledger (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('purchase','gift_sent','gift_received','referral_bonus','challenge_prize')),
  counterpart_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS star_ledger_user_idx ON star_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS star_ledger_post_idx ON star_ledger(post_id) WHERE post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS star_purchases (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars > 0),
  amount_kz NUMERIC(12,2) NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  stripe_session_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marketplace de marcas: propostas de campanhas pagas a criadores.
CREATE TABLE IF NOT EXISTS brand_campaigns (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(100) NOT NULL,
  brief VARCHAR(2000) NOT NULL,
  budget NUMERIC(12,2) NOT NULL CHECK (budget > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','declined','paid','completed','cancelled')),
  stripe_session_id TEXT,
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (brand_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS brand_campaigns_creator_idx ON brand_campaigns(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_campaigns_brand_idx ON brand_campaigns(brand_id, created_at DESC);

-- Desafios mensais.
CREATE TABLE IF NOT EXISTS challenges (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  prize VARCHAR(120) NOT NULL DEFAULT '',
  prize_stars INTEGER NOT NULL DEFAULT 0 CHECK (prize_stars >= 0),
  sponsor VARCHAR(80) NOT NULL DEFAULT 'Biva',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  winner_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS challenge_entries (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (challenge_id, post_id),
  UNIQUE (challenge_id, user_id)
);
