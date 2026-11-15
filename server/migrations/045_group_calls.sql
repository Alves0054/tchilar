-- Chamadas de voz e vídeo nos grupos (até 8 pessoas, ligações diretas entre os participantes).
CREATE TABLE IF NOT EXISTS group_calls (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  started_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind VARCHAR(5) NOT NULL CHECK (kind IN ('voice','video')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
-- Só uma chamada aberta por grupo.
CREATE UNIQUE INDEX IF NOT EXISTS group_calls_one_open ON group_calls(group_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS group_call_participants (
  call_id INTEGER NOT NULL REFERENCES group_calls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  camera BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (call_id, user_id)
);

-- Ofertas e respostas WebRTC entre participantes (apagadas assim que são entregues).
CREATE TABLE IF NOT EXISTS group_call_signals (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES group_calls(id) ON DELETE CASCADE,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(6) NOT NULL CHECK (kind IN ('offer','answer','bye')),
  payload TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_call_signals_to_idx ON group_call_signals(call_id, to_user, id);

-- Notificações que levam a um grupo (ex.: "começou uma chamada").
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES social_groups(id) ON DELETE CASCADE;
