-- Bilhetes de eventos: a regra fica na base de dados, para valer em todos os caminhos.
-- 1) Cada estrela recebida por um bilhete guarda quando passa a poder ser levantada (1 dia depois de o evento
--    começar). Não depende de o evento continuar a existir.
ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;
UPDATE star_ledger s SET available_at = e.starts_at + INTERVAL '1 day'
FROM events e WHERE s.event_id = e.id AND s.kind = 'gift_received' AND s.available_at IS NULL;

-- 2) Um evento que desaparece antes de começar (apagado por quem organiza, com a página, o grupo ou a conta)
--    devolve as estrelas a quem comprou bilhete e retira-as a quem organiza. Depois de começar não se devolve.
CREATE OR REPLACE FUNCTION refund_event_tickets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.starts_at > NOW() THEN
    INSERT INTO star_ledger(user_id,amount,kind)
    SELECT t.user_id, t.stars, 'refund' FROM event_tickets t WHERE t.event_id = OLD.id AND t.stars > 0;
    INSERT INTO notifications(user_id,type,text)
    SELECT t.user_id, 'event_refund', 'O evento «' || OLD.name || '» foi cancelado. Devolvemos-te ' || t.stars || ' estrelas do bilhete.'
    FROM event_tickets t WHERE t.event_id = OLD.id AND t.stars > 0;
    DELETE FROM star_ledger WHERE event_id = OLD.id AND kind = 'gift_received';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS events_refund_tickets ON events;
CREATE TRIGGER events_refund_tickets
BEFORE DELETE ON events
FOR EACH ROW EXECUTE FUNCTION refund_event_tickets();
