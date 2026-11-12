-- Programa de Parceiros: data em que o criador aderiu (só depois disso acumula ganhos).
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_since TIMESTAMPTZ;

-- Promoções pagas: um anúncio pode impulsionar uma publicação e só fica ativo depois de pago.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS days INTEGER NOT NULL DEFAULT 7 CHECK (days BETWEEN 1 AND 30);
ALTER TABLE ads ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_status_check;
ALTER TABLE ads ADD CONSTRAINT ads_status_check CHECK (status IN ('pending_payment','active','paused','ended'));

-- Anúncios criados antes desta regra contam como já pagos.
UPDATE ads SET paid_at = created_at WHERE paid_at IS NULL AND status <> 'pending_payment';

CREATE INDEX IF NOT EXISTS ads_post_idx ON ads(post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ads_stripe_session_idx ON ads(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
