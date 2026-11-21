-- Telemóvel: países da CPLP (formato internacional, "+244923456789") e um número por conta, para se poder
-- iniciar sessão com ele. Até aqui só havia números angolanos de 9 dígitos, sem regra de número único.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_check;
ALTER TABLE users ALTER COLUMN phone TYPE VARCHAR(16);

-- Os números angolanos que já existiam passam a levar o indicativo.
UPDATE users SET phone = '+244' || phone WHERE phone ~ '^9[0-9]{8}$';

-- Números repetidos: fica com ele a conta mais antiga; as outras perdem o número e recebem um aviso
-- (podem pôr outro em Definições → Conta).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at, id) AS position
  FROM users WHERE phone IS NOT NULL
), cleared AS (
  UPDATE users u SET phone = NULL
  FROM ranked r WHERE r.id = u.id AND r.position > 1
  RETURNING u.id
)
INSERT INTO notifications(user_id, type, text)
SELECT id, 'privacy', 'O teu número de telemóvel estava também noutra conta e foi retirado da tua. Agora cada número só pode estar numa conta (serve para iniciar sessão): indica outro em Definições → Conta.'
FROM cleared;

ALTER TABLE users ADD CONSTRAINT users_phone_check CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');
DROP INDEX IF EXISTS users_phone_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
