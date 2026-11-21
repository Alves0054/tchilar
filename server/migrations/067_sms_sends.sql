-- Cada código enviado por SMS ou WhatsApp (Twilio Verify): serve para os limites (um por minuto, 5 por número por dia,
-- teto diário do Tchilar) e para saber quanto se gasta. Não guarda o código, só que foi enviado.
CREATE TABLE IF NOT EXISTS sms_sends (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel VARCHAR(10) NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp')),
  purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('confirm', 'recover')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sms_sends_phone_created_idx ON sms_sends(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_sends_created_idx ON sms_sends(created_at);
