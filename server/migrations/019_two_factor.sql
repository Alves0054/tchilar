-- Verificação em dois passos (TOTP). O segredo fica cifrado (AES-256-GCM, a mesma chave dos IBAN).
-- totp_enabled_at NULL com segredo preenchido = configuração iniciada mas ainda não confirmada.
-- totp_last_step guarda o último código aceite, para o mesmo código não servir duas vezes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;
