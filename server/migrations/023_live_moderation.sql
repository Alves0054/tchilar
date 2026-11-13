-- Moderação e destaque no chat dos diretos.
-- Mensagens apagadas pela moderação ficam escondidas (não são apagadas da base de dados).
ALTER TABLE live_comments ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE live_comments ADD COLUMN IF NOT EXISTS hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Mensagem fixada no topo do chat.
ALTER TABLE lives ADD COLUMN IF NOT EXISTS pinned_comment_id INTEGER REFERENCES live_comments(id) ON DELETE SET NULL;

-- Moderadores escolhidos por quem emite: valem para todos os diretos dessa pessoa.
CREATE TABLE IF NOT EXISTS live_moderators (
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (host_id, moderator_id),
  CHECK (host_id <> moderator_id)
);

-- Pessoas silenciadas num direto (até "until"; NULL = até ao fim do direto).
CREATE TABLE IF NOT EXISTS live_mutes (
  live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  until TIMESTAMPTZ,
  muted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (live_id, user_id)
);
