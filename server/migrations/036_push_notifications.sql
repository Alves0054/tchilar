-- Notificações push (app iOS/Android através do serviço de push do Expo).
-- Cada telemóvel regista o seu token; auth_version liga o token à sessão: terminar sessões, mudar a
-- palavra-passe ou suspender a conta faz o token deixar de receber avisos.
CREATE TABLE IF NOT EXISTS push_tokens (
  token VARCHAR(200) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios','android')),
  auth_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON push_tokens(user_id);

-- Cada notificação é enviada uma vez: pushed_at marca as já tratadas (com ou sem telemóvel registado).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
UPDATE notifications SET pushed_at=COALESCE(created_at, NOW()) WHERE pushed_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_push_pending_idx ON notifications(id) WHERE pushed_at IS NULL;
