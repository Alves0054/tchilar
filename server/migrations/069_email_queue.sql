-- Fila de emails: cada email fica guardado antes de sair e é enviado ao ritmo que o fornecedor permite
-- (Resend grátis: 100 por dia). Emails de conta (confirmar, recuperar) saem antes dos avisos da equipa.
CREATE TABLE IF NOT EXISTS email_queue (
  id BIGSERIAL PRIMARY KEY,
  to_email VARCHAR(255) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('account', 'notice')),
  priority SMALLINT NOT NULL DEFAULT 1,              -- 0 = conta (primeiro), 1 = avisos
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                            -- ligações de conta deixam de valer: não vale a pena enviar depois
  broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE SET NULL,
  last_error VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_queue_due_idx ON email_queue(priority, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_queue_sent_idx ON email_queue(sent_at) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS email_queue_broadcast_idx ON email_queue(broadcast_id) WHERE broadcast_id IS NOT NULL;
