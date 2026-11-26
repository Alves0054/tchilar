-- Promoções entregues por pessoas: quem paga escolhe a quantas pessoas chega (orçamento ÷ custo por pessoa)
-- e a promoção continua no ar, no feed, nos Reels e nos Stories, até ser mostrada a essas pessoas.
-- Cada pessoa conta (e paga) uma só vez por promoção, mesmo que a veja em dias ou sítios diferentes.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_reach INTEGER;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS delivered INTEGER NOT NULL DEFAULT 0;
-- Se não chegar a todas as pessoas até 14 dias depois do fim, termina e guarda o valor que não foi usado.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS undelivered_kz NUMERIC(12,2);

-- Promoções antigas: o mesmo cálculo de agora (0,50 Kz por pessoa; +20% se escolheu províncias ou idades).
UPDATE ads SET target_reach = FLOOR(budget / (0.5 * CASE
    WHEN cardinality(target_provinces) > 0 OR target_min_age IS NOT NULL OR target_max_age IS NOT NULL THEN 1.2 ELSE 1 END))
  WHERE target_reach IS NULL;
UPDATE ads a SET delivered = (SELECT COUNT(DISTINCT e.user_id) FROM ad_events e WHERE e.ad_id=a.id AND e.kind='impression');
ALTER TABLE ads DROP CONSTRAINT IF EXISTS ads_target_reach_check;
ALTER TABLE ads ADD CONSTRAINT ads_target_reach_check CHECK (target_reach > 0);

-- Qualquer promoção criada sem o número de pessoas (ex.: pela equipa) fica com o mesmo cálculo.
CREATE OR REPLACE FUNCTION ads_default_target_reach() RETURNS trigger AS $$
BEGIN
  IF NEW.target_reach IS NULL THEN
    NEW.target_reach := GREATEST(1, FLOOR(NEW.budget / (0.5 * CASE
      WHEN cardinality(COALESCE(NEW.target_provinces, '{}')) > 0 OR NEW.target_min_age IS NOT NULL OR NEW.target_max_age IS NOT NULL
      THEN 1.2 ELSE 1 END)));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ads_default_target_reach ON ads;
CREATE TRIGGER ads_default_target_reach BEFORE INSERT ON ads FOR EACH ROW EXECUTE FUNCTION ads_default_target_reach();
