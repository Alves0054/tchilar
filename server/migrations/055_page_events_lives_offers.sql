ALTER TABLE events ADD COLUMN IF NOT EXISTS page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS events_page_idx ON events(page_id, starts_at) WHERE page_id IS NOT NULL;

ALTER TABLE lives ADD COLUMN IF NOT EXISTS page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lives_page_status_idx ON lives(page_id, status, started_at DESC) WHERE page_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS page_offers (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  price_kz NUMERIC(12,2) NOT NULL CHECK (price_kz > 0),
  discount_percent SMALLINT NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  promo_code VARCHAR(40),
  expires_at TIMESTAMPTZ,
  promo_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  checkout_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS page_offers_page_code_idx
  ON page_offers(page_id, promo_code) WHERE promo_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS page_offers_page_created_idx ON page_offers(page_id, created_at DESC);
