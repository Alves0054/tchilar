-- Verificação paga também para páginas: o mesmo selo (Kazola azul, Bolado vermelho, Benga dourado),
-- com os seguidores da página a contar para os requisitos.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS verification_tier VARCHAR(16)
  CHECK (verification_tier IS NULL OR verification_tier IN ('kazola','bolado','benga'));
ALTER TABLE pages ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

-- Uma compra é de uma conta (page_id vazio) ou de uma página dessa conta.
ALTER TABLE verification_purchases ADD COLUMN IF NOT EXISTS page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS verification_purchases_page_idx ON verification_purchases(page_id) WHERE page_id IS NOT NULL;
