-- Presença: quando a pessoa usou a app pela última vez (atualizado no máximo uma vez por minuto).
-- Só aparece aos amigos como "online", e só se a pessoa não desligou "Mostrar quando estou ativo".
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users(last_seen_at DESC) WHERE last_seen_at IS NOT NULL;
