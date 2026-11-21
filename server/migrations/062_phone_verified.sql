-- Telemóvel confirmado por SMS (Twilio Verify). Só um número CONFIRMADO conta como "um número por conta" e serve
-- para iniciar sessão ou recuperar a conta. Um número por confirmar pode estar em mais de uma conta: assim ninguém
-- fica com o número de outra pessoa só por o escrever primeiro, e o registo não revela quem usa o Tchilar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

DROP INDEX IF EXISTS users_phone_unique;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_verified_unique ON users(phone) WHERE phone_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone) WHERE phone IS NOT NULL;
