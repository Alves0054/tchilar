-- Grupos secretos com entrada única (até 50 000 Kz) ou mensal (até 20 000 Kz por mês).
-- Na mensal, cada membro que pagou tem acesso até access_until; 3 dias antes recebe um aviso para renovar
-- e, se não renovar, sai do grupo quando o acesso acaba. O dono e a equipa do grupo não têm data de fim.
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS access_billing VARCHAR(10) NOT NULL DEFAULT 'once';
ALTER TABLE social_groups DROP CONSTRAINT IF EXISTS social_groups_access_billing_check;
ALTER TABLE social_groups ADD CONSTRAINT social_groups_access_billing_check CHECK (access_billing IN ('once','monthly'));

ALTER TABLE group_members ADD COLUMN IF NOT EXISTS access_until TIMESTAMPTZ;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS renewal_reminded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS group_members_access_until_idx ON group_members(access_until) WHERE access_until IS NOT NULL;

-- Cada pagamento guarda se foi entrada única ou um mês, e até quando deu acesso.
ALTER TABLE group_access_purchases ADD COLUMN IF NOT EXISTS billing VARCHAR(10) NOT NULL DEFAULT 'once';
ALTER TABLE group_access_purchases DROP CONSTRAINT IF EXISTS group_access_purchases_billing_check;
ALTER TABLE group_access_purchases ADD CONSTRAINT group_access_purchases_billing_check CHECK (billing IN ('once','monthly'));
ALTER TABLE group_access_purchases ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
