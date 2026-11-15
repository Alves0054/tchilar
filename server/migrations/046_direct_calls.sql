-- Chamadas a partir das mensagens (sem grupo): quem liga convida uma ou mais pessoas (até 8 na chamada).
ALTER TABLE group_calls ALTER COLUMN group_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS call_invites (
  call_id INTEGER NOT NULL REFERENCES group_calls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  declined_at TIMESTAMPTZ,
  PRIMARY KEY (call_id, user_id)
);
CREATE INDEX IF NOT EXISTS call_invites_user_idx ON call_invites(user_id, created_at DESC);

-- Notificação "está a ligar-te" leva à chamada.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS call_id INTEGER REFERENCES group_calls(id) ON DELETE CASCADE;
