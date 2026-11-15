-- Sessões por aparelho: cada início de sessão fica registado (aparelho, quando entrou, última vez visto).
-- As sessões não expiram; terminam quando a pessoa sai, termina esse aparelho nas Definições, termina as outras
-- sessões, muda a palavra-passe ou a conta é suspensa. O token leva o id da sessão (sid).
CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client VARCHAR(8) NOT NULL DEFAULT 'web' CHECK (client IN ('web','app')),
  device VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id) WHERE revoked_at IS NULL;
