-- Presentes nos diretos (rosa, coroa, foguetão...): o comentário do presente guarda qual foi, para o site e a app
-- mostrarem o ícone e tocarem o som certo.
ALTER TABLE live_comments ADD COLUMN IF NOT EXISTS gift VARCHAR(30);
