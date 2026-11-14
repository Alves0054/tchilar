-- Fundo escolhido para um story de texto (chave de story-backgrounds.json). NULL = o fundo automático de antes.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS background VARCHAR(30);
