-- Telemóvel da conta (opcional): 9 dígitos angolanos, sem o +244. É privado: não aparece no perfil público.
-- Serve para contacto da equipa e para preencher o Multicaixa Express nos pagamentos.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(9) CHECK (phone ~ '^9[0-9]{8}$');
-- Um número só pode estar numa conta.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
