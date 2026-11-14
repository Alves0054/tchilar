-- Operações da equipa: reembolsos de todos os produtos, funções na equipa, pedidos sobre dados pessoais,
-- avisos gerais e esconder grupos/páginas sem precisar de denúncia.

-- Reembolsos: o mesmo estado que as promoções já tinham (refunded | manual | failed | not_needed).
-- "manual"/"failed" = o acesso já foi retirado, mas o dinheiro ainda tem de ser devolvido à mão.
ALTER TABLE star_purchases ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed'));
ALTER TABLE star_purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE group_access_purchases ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed'));
ALTER TABLE group_access_purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE brand_campaigns ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed'));
ALTER TABLE brand_campaigns ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Estrelas devolvidas saem do saldo com um movimento próprio.
ALTER TABLE star_ledger DROP CONSTRAINT IF EXISTS star_ledger_kind_check;
ALTER TABLE star_ledger ADD CONSTRAINT star_ledger_kind_check
  CHECK (kind IN ('purchase','gift_sent','gift_received','referral_bonus','challenge_prize','refund'));

-- Funções: super (tudo), finance (dinheiro) e moderation (pessoas e conteúdo).
-- Quem já era admin continua a poder fazer tudo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role VARCHAR(12) CHECK (admin_role IN ('super','finance','moderation'));
UPDATE users SET admin_role='super' WHERE is_admin AND admin_role IS NULL;

-- Pedidos sobre dados pessoais (Lei n.º 22/11): cópia, correção, apagar a conta ou outro assunto.
CREATE TABLE IF NOT EXISTS data_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(40) NOT NULL,
  email VARCHAR(160) NOT NULL,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('export','correct','delete','other')),
  details VARCHAR(1000) NOT NULL DEFAULT '',
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','rejected')),
  answer VARCHAR(1000) NOT NULL DEFAULT '',
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS data_requests_status_idx ON data_requests(status, created_at);
-- Só um pedido aberto de cada tipo por pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_open_idx ON data_requests(user_id, kind) WHERE status='open';

-- Avisos gerais enviados pela equipa.
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  audience VARCHAR(60) NOT NULL,
  channel VARCHAR(12) NOT NULL CHECK (channel IN ('notification','email','both')),
  recipients INTEGER NOT NULL DEFAULT 0,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grupos e páginas escondidos pela equipa: saem das listas e das sugestões, e ninguém entra.
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
