-- Loja nas páginas: só existe quando quem gere a página a liga (ao criar a página ou em Editar informações).
-- Sem loja, o separador "Loja" não aparece e não se podem criar ofertas. As páginas que já tinham ofertas ficam com a loja ligada.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS shop_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE pages p SET shop_enabled = TRUE WHERE EXISTS (SELECT 1 FROM page_offers o WHERE o.page_id = p.id);
