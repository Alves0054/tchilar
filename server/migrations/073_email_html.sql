-- Emails com desenho (HTML) na fila, além do texto simples (os programas de email que não mostram HTML usam o texto).
-- Novo tipo "receipt": emails de compras (bilhetes...), que saem logo a seguir aos de conta, antes dos avisos.
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html TEXT;
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_kind_check;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_kind_check CHECK (kind IN ('account', 'receipt', 'notice'));
