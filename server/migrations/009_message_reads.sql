-- Mensagens lidas/não lidas (para contadores e atualização ao vivo).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages(receiver_id) WHERE read_at IS NULL;
-- Mensagens antigas contam como lidas.
UPDATE messages SET read_at = created_at WHERE read_at IS NULL;
