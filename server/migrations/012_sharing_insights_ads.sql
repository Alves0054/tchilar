-- Partilhas: uma partilha é uma publicação nova que aponta para a original.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS shared_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_shared_post_idx ON posts(shared_post_id) WHERE shared_post_id IS NOT NULL;

-- Visualizações de publicações: uma por pessoa, por publicação e por dia (alimenta o painel do criador).
CREATE TABLE IF NOT EXISTS post_views (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (post_id, viewer_id, viewed_on)
);
CREATE INDEX IF NOT EXISTS post_views_day_idx ON post_views(viewed_on, post_id);

-- Anúncios criados no painel do criador. Valores em kwanzas (Kz).
CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  body VARCHAR(200) NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  budget NUMERIC(12,2) NOT NULL CHECK (budget > 0),
  spent NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (spent >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ads_serving_idx ON ads(status, ends_at);
CREATE INDEX IF NOT EXISTS ads_owner_idx ON ads(owner_id, created_at DESC);

-- Impressões e cliques: no máximo um de cada por pessoa, anúncio e dia.
CREATE TABLE IF NOT EXISTS ad_events (
  ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('impression','click')),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ad_id, user_id, kind, day)
);
