-- Convites: ranking do mês por província (quem convidou pessoas que já entraram e publicaram).
CREATE INDEX IF NOT EXISTS users_referral_rewarded_idx ON users(referred_by, referral_rewarded_at)
  WHERE referral_rewarded_at IS NOT NULL;

-- Lojas das páginas: encomendar pelo WhatsApp e selo de negócio verificado (a equipa confirma o NIF).
ALTER TABLE pages ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20);                -- número internacional, só dígitos
ALTER TABLE pages ADD COLUMN IF NOT EXISTS business_nif VARCHAR(20);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS business_requested_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS business_verified_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS business_rejected_reason VARCHAR(200);
CREATE INDEX IF NOT EXISTS pages_business_requests_idx ON pages(business_requested_at)
  WHERE business_requested_at IS NOT NULL AND business_verified_at IS NULL;

-- Bilhetes de eventos, pagos em estrelas. Cada bilhete tem um código (mostrado em QR) validado à entrada.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_stars INTEGER NOT NULL DEFAULT 0 CHECK (ticket_stars BETWEEN 0 AND 100000);
ALTER TABLE events ADD COLUMN IF NOT EXISTS tickets_total INTEGER CHECK (tickets_total IS NULL OR tickets_total BETWEEN 1 AND 100000);
CREATE TABLE IF NOT EXISTS event_tickets (
  id BIGSERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(16) NOT NULL UNIQUE,
  stars INTEGER NOT NULL CHECK (stars >= 0),
  checked_in_at TIMESTAMPTZ,
  checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

-- Diretos pagos: entrada em estrelas, paga uma vez por direto.
ALTER TABLE lives ADD COLUMN IF NOT EXISTS entry_stars INTEGER NOT NULL DEFAULT 0 CHECK (entry_stars BETWEEN 0 AND 10000);
CREATE TABLE IF NOT EXISTS live_tickets (
  live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (live_id, user_id)
);

-- Estrelas gastas em bilhetes: ficam ligadas ao evento (para devolver se o evento for cancelado).
ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS star_ledger_event_idx ON star_ledger(event_id) WHERE event_id IS NOT NULL;
