-- Notificações no browser (web push): cada browser regista a sua subscrição (endereço do serviço de push e
-- chaves). Fica ligada à sessão do site (session_id) e à auth_version: terminar essa sessão, terminar as
-- outras, mudar a palavra-passe ou suspender a conta faz o browser deixar de receber avisos.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  endpoint VARCHAR(1000) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id VARCHAR(36) REFERENCES user_sessions(id) ON DELETE CASCADE,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  auth_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);
