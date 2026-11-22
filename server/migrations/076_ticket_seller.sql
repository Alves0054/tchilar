-- Quem vende os bilhetes (a empresa ou a pessoa que organiza o evento), para aparecer no recibo.
-- Fica guardado na conta (para preencher os próximos eventos), no evento e em cada compra (o recibo não muda
-- se a pessoa alterar os dados depois).
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_name VARCHAR(160);
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_nif VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_address VARCHAR(240);

ALTER TABLE events ADD COLUMN IF NOT EXISTS seller_name VARCHAR(160);
ALTER TABLE events ADD COLUMN IF NOT EXISTS seller_nif VARCHAR(20);
ALTER TABLE events ADD COLUMN IF NOT EXISTS seller_address VARCHAR(240);

ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS seller_name VARCHAR(160);
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS seller_nif VARCHAR(20);
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS seller_address VARCHAR(240);
