CREATE TABLE IF NOT EXISTS stories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(500) NOT NULL DEFAULT '',
  media_url TEXT DEFAULT '',
  media_type VARCHAR(20) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CHECK (length(trim(body)) > 0 OR media_url <> '')
);

CREATE INDEX IF NOT EXISTS stories_active_created_idx ON stories(expires_at, created_at DESC);
