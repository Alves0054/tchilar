-- Espectadores de cada direto, gravados a cada 15 s pela cópia da API que conta esse direto.
-- Com várias cópias da API, a lista de diretos lê daqui os diretos que outra cópia está a contar.
ALTER TABLE lives ADD COLUMN IF NOT EXISTS current_viewers INTEGER NOT NULL DEFAULT 0;
