-- Preferências da conta (notificações por categoria, quem pode enviar mensagens e comentar).
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Notificações de categorias desligadas não chegam a ser guardadas.
-- Mantém-se em sintonia com NOTIFY_CATEGORIES em server/preferences.js.
CREATE OR REPLACE FUNCTION notifications_respect_preferences() RETURNS trigger AS $$
DECLARE
  category TEXT;
BEGIN
  category := CASE
    WHEN NEW.type IN ('like', 'comment', 'share') THEN 'interactions'
    WHEN NEW.type IN ('follow', 'friend_request', 'friend_accepted') THEN 'people'
    WHEN NEW.type = 'message' THEN 'messages'
    WHEN NEW.type = 'live' THEN 'lives'
    WHEN NEW.type IN ('group_join', 'page_follow', 'event_rsvp') THEN 'community'
    ELSE NULL
  END;
  IF category IS NOT NULL AND EXISTS (
    SELECT 1 FROM users WHERE id = NEW.user_id AND preferences -> 'notify' ->> category = 'false'
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_preferences ON notifications;
CREATE TRIGGER notifications_preferences BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_respect_preferences();
