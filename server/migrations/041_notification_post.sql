-- Notificações sobre uma publicação (gosto, comentário, partilha) levam à página dessa publicação.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL;
