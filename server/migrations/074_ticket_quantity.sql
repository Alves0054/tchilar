-- Várias entradas por compra: cada compra (event_tickets) tem uma quantidade e cada entrada tem o seu código
-- (e o seu QR), para cada pessoa entrar com o seu. Uma pessoa pode fazer mais do que uma compra para o mesmo evento.
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20);
ALTER TABLE event_tickets DROP CONSTRAINT IF EXISTS event_tickets_event_id_user_id_key;
CREATE INDEX IF NOT EXISTS event_tickets_event_user_idx ON event_tickets(event_id, user_id);

CREATE TABLE IF NOT EXISTS event_ticket_codes (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES event_tickets(id) ON DELETE CASCADE,
  code VARCHAR(16) NOT NULL UNIQUE,
  checked_in_at TIMESTAMPTZ,
  checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS event_ticket_codes_ticket_idx ON event_ticket_codes(ticket_id);

-- Os bilhetes já vendidos (um por compra) passam para a tabela nova, com o mesmo código e a mesma entrada.
INSERT INTO event_ticket_codes(ticket_id,code,checked_in_at,checked_in_by,created_at)
SELECT id, code, checked_in_at, checked_in_by, COALESCE(paid_at, created_at) FROM event_tickets
WHERE code IS NOT NULL
ON CONFLICT (code) DO NOTHING;
UPDATE event_tickets SET code = NULL WHERE code IS NOT NULL;
