-- Cada telemóvel guarda uma chave secreta só sua (no cofre do sistema) e envia-a ao registar o token.
-- Só quem tem essa chave (o próprio telemóvel) pode passar o token para outra conta: quem souber apenas
-- o token não desvia os avisos, e quem entra noutra conta no mesmo telemóvel deixa de receber os da anterior.
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS device_key_hash CHAR(64);
