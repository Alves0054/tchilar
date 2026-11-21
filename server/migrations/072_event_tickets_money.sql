-- Bilhetes de eventos pagos com dinheiro (Express, Referência, PayPay, PayPal...), como os cursos.
-- Quem organiza fica com 85% de cada venda; o Tchilar fica com 15%. O dinheiro dos bilhetes só pode ser
-- levantado 1 dia depois de o evento começar (available_at), para poder ser devolvido se o evento for cancelado.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_price_kz NUMERIC(12,2) NOT NULL DEFAULT 0
  CHECK (ticket_price_kz = 0 OR ticket_price_kz BETWEEN 100 AND 1000000);
-- Os bilhetes em estrelas deixam de existir (ainda não havia vendas reais).
UPDATE events SET ticket_stars = 0 WHERE ticket_stars <> 0;

ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS amount_kz NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid'));
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS event_name VARCHAR(120);
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed'));
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;
ALTER TABLE event_tickets ALTER COLUMN stars SET DEFAULT 0;
-- O código só existe depois de pago.
ALTER TABLE event_tickets ALTER COLUMN code DROP NOT NULL;

-- As compras ficam registadas (recibos, reembolsos) mesmo que o evento seja apagado.
ALTER TABLE event_tickets ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE event_tickets DROP CONSTRAINT IF EXISTS event_tickets_event_id_fkey;
ALTER TABLE event_tickets ADD CONSTRAINT event_tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS event_tickets_owner_idx ON event_tickets(owner_id) WHERE status = 'paid';

-- Evento que desaparece antes de começar (apagado, com a página, o grupo ou a conta de quem organiza):
-- os bilhetes pagos ficam "por devolver" (a equipa devolve e confirma em Administração → Pagamentos) e saem
-- do saldo de quem organiza.
CREATE OR REPLACE FUNCTION refund_event_tickets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.starts_at > NOW() THEN
    INSERT INTO notifications(user_id,type,text)
    SELECT t.user_id, 'event_refund', 'O evento «' || OLD.name || '» foi cancelado. Vamos devolver-te ' ||
      to_char(t.amount_kz, 'FM999G999G990') || ' Kz do bilhete.'
    FROM event_tickets t WHERE t.event_id = OLD.id AND t.status = 'paid' AND t.refund_status IS NULL;
    UPDATE event_tickets SET refund_status = 'manual'
    WHERE event_id = OLD.id AND status = 'paid' AND refund_status IS NULL;
  END IF;
  RETURN OLD;
END;
$$;
