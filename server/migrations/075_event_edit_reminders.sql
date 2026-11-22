-- Notificações ligadas a um evento (lembretes, mudanças de data ou local): tocar abre o evento.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;

-- Lembretes já enviados (1 dia antes e 1 hora antes), para não repetir. Se a data mudar, voltam a ser enviados.
CREATE TABLE IF NOT EXISTS event_reminders_sent (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('day', 'hour')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, kind)
);
