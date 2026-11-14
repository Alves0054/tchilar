-- Registo do que a equipa faz no painel: quem aprovou, recusou, reembolsou ou suspendeu, e quando.
-- Só se acrescentam linhas; nada no código as altera nem apaga.
CREATE TABLE IF NOT EXISTS admin_actions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  target_id INTEGER,
  note VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_target_idx ON admin_actions(target_type, target_id, created_at DESC);

-- Motivo da suspensão (mostrado à equipa na ficha da pessoa).
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason VARCHAR(300);
-- Quando a equipa confirma que um reembolso feito à mão (Express/Referência) foi devolvido.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
