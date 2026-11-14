-- Grupos: tema (da lista em community-types.json) e grupos privados, em que o dono aprova quem entra.
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS topic VARCHAR(30) NOT NULL DEFAULT 'geral';
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
-- Um grupo secreto já tem a sua própria entrada (paga); não pode ser também "com aprovação".
ALTER TABLE social_groups DROP CONSTRAINT IF EXISTS social_groups_private_or_secret_check;
ALTER TABLE social_groups ADD CONSTRAINT social_groups_private_or_secret_check CHECK (NOT (is_secret AND requires_approval));
CREATE INDEX IF NOT EXISTS social_groups_topic_idx ON social_groups(topic);

CREATE TABLE IF NOT EXISTS group_join_requests (
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Páginas: tipo + categoria, guardados como chaves. As 13 categorias antigas (texto livre) passam para a nova lista.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS page_type VARCHAR(30) NOT NULL DEFAULT 'comunidade';
UPDATE pages SET (page_type, category) = (
  CASE category
    WHEN 'Negócio local' THEN 'negocio'
    WHEN 'Marca' THEN 'empresa' WHEN 'Tecnologia' THEN 'empresa' WHEN 'Moda e beleza' THEN 'empresa' WHEN 'Comida e bebida' THEN 'empresa'
    WHEN 'Artista' THEN 'figura' WHEN 'Música' THEN 'figura'
    WHEN 'Entretenimento' THEN 'entretenimento'
    WHEN 'Desporto' THEN 'organizacao' WHEN 'Educação' THEN 'organizacao' WHEN 'Organização sem fins lucrativos' THEN 'organizacao'
    ELSE 'comunidade' END,
  CASE category
    WHEN 'Negócio local' THEN 'servicos'
    WHEN 'Marca' THEN 'marca' WHEN 'Tecnologia' THEN 'tecnologia' WHEN 'Moda e beleza' THEN 'moda' WHEN 'Comida e bebida' THEN 'comida'
    WHEN 'Artista' THEN 'artista' WHEN 'Música' THEN 'musico'
    WHEN 'Entretenimento' THEN 'eventos'
    WHEN 'Desporto' THEN 'clube' WHEN 'Educação' THEN 'escola' WHEN 'Organização sem fins lucrativos' THEN 'ong'
    WHEN 'Notícias' THEN 'noticias'
    ELSE 'comunidade' END)
WHERE page_type = 'comunidade' AND category !~ '^[a-z-]+$';
ALTER TABLE pages ALTER COLUMN category SET DEFAULT 'comunidade';
CREATE INDEX IF NOT EXISTS pages_type_idx ON pages(page_type, category);
