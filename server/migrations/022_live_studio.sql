-- Estúdio de diretos: detalhes da emissão, origem do vídeo e chave de transmissão (OBS e afins).
ALTER TABLE lives ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE lives ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT '';
-- browser: câmara/placa de captura/ecrã no browser; obs: programa de transmissão com chave (RTMP ou WHIP).
ALTER TABLE lives ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'browser';
ALTER TABLE lives DROP CONSTRAINT IF EXISTS lives_source_check;
ALTER TABLE lives ADD CONSTRAINT lives_source_check CHECK (source IN ('browser','obs'));
-- Pessoas diferentes que viram o direto (o pico continua em peak_viewers).
ALTER TABLE lives ADD COLUMN IF NOT EXISTS unique_viewers INTEGER NOT NULL DEFAULT 0;

-- A chave nunca é guardada em claro: só o hash SHA-256. Perdida a chave, gera-se outra.
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_key_hash VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream_key_created_at TIMESTAMPTZ;
