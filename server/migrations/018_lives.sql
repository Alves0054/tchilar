-- Diretos (lives): emissão de vídeo com chat, espectadores e estrelas.
CREATE TABLE IF NOT EXISTS lives (
  id SERIAL PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  host_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  peak_viewers INTEGER NOT NULL DEFAULT 0
);
-- Cada pessoa só pode ter um direto ativo de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS lives_one_active_per_host ON lives(host_id) WHERE status='live';
CREATE INDEX IF NOT EXISTS lives_status_idx ON lives(status, started_at DESC);

-- Quem está a ver (atualizado a cada poucos segundos; conta quem foi visto há menos de 30 s).
CREATE TABLE IF NOT EXISTS live_viewers (
  live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (live_id, user_id)
);

-- Chat do direto (inclui mensagens automáticas de estrelas oferecidas).
CREATE TABLE IF NOT EXISTS live_comments (
  id SERIAL PRIMARY KEY,
  live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body VARCHAR(300) NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_comments_live_idx ON live_comments(live_id, id);

-- Sinalização WebRTC entre quem emite e cada espectador (oferta/resposta SDP).
CREATE TABLE IF NOT EXISTS live_signals (
  id SERIAL PRIMARY KEY,
  live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('offer','answer','bye')),
  payload TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_signals_to_idx ON live_signals(live_id, to_user, id);

-- Estrelas oferecidas durante um direto.
ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS live_id INTEGER REFERENCES lives(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS star_ledger_live_idx ON star_ledger(live_id) WHERE live_id IS NOT NULL;
