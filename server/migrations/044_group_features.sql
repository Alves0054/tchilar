-- Grupos: tipo (para que serve), categoria e subcategoria, quatro níveis de entrada (público, com aprovação,
-- privado por convite, secreto), regras, administradores e moderadores, convites, publicações fixadas,
-- sondagens, chat do grupo, ficheiros e eventos do grupo.

ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS group_type VARCHAR(30) NOT NULL DEFAULT 'comunitario';
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'comunidade';
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS subcategory VARCHAR(40);
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS invite_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE social_groups ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT '';
ALTER TABLE social_groups DROP CONSTRAINT IF EXISTS social_groups_access_mode_check;
ALTER TABLE social_groups ADD CONSTRAINT social_groups_access_mode_check
  CHECK ((is_secret::int + requires_approval::int + invite_only::int) <= 1);

-- Os temas antigos passam para as categorias (e sugerem o tipo).
UPDATE social_groups g SET category = m.category, subcategory = m.sub, group_type = m.kind
FROM (VALUES
  ('geral','comunidade',NULL,'comunitario'),
  ('amigos','relacionamentos',NULL,'comunitario'),
  ('bairro','comunidade','bairro-e-municipio','local'),
  ('compra-venda','compra-venda',NULL,'compra-venda'),
  ('empreender','negocios','empreendedores','profissional'),
  ('trabalho','carreira',NULL,'networking'),
  ('estudo','educacao','estudantes','estudo'),
  ('tecnologia','tecnologia-criatividade',NULL,'comunitario'),
  ('desporto','desporto',NULL,'comunitario'),
  ('jogos','jogos',NULL,'jogos'),
  ('musica','musica-entretenimento',NULL,'comunitario'),
  ('arte','fotografia-artes',NULL,'comunitario'),
  ('moda','moda-beleza',NULL,'comunitario'),
  ('culinaria','gastronomia','receitas','comunitario'),
  ('saude','saude',NULL,'apoio'),
  ('pais','comunidade','pais-e-maes','apoio'),
  ('fe','religiao',NULL,'comunitario'),
  ('viagens','viagens',NULL,'comunitario'),
  ('causas','solidariedade',NULL,'voluntariado'),
  ('fas','musica-entretenimento',NULL,'fas')
) AS m(topic, category, sub, kind)
WHERE g.topic = m.topic;

-- Papéis: dono, administradores, moderadores e membros.
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role VARCHAR(12) NOT NULL DEFAULT 'member';
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
ALTER TABLE group_members ADD CONSTRAINT group_members_role_check CHECK (role IN ('owner','admin','moderator','member'));
UPDATE group_members m SET role='owner' FROM social_groups g WHERE g.id=m.group_id AND g.owner_id=m.user_id;

-- Convites (grupos privados: só entra quem foi convidado).
CREATE TABLE IF NOT EXISTS group_invites (
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- Publicações fixadas no topo do grupo.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Sondagens.
CREATE TABLE IF NOT EXISTS group_polls (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  question VARCHAR(200) NOT NULL,
  multiple BOOLEAN NOT NULL DEFAULT FALSE,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_polls_group_idx ON group_polls(group_id, created_at DESC);
CREATE TABLE IF NOT EXISTS group_poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
  label VARCHAR(100) NOT NULL,
  position SMALLINT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_poll_votes (
  poll_id INTEGER NOT NULL REFERENCES group_polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES group_poll_options(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, option_id, user_id)
);

-- Chat do grupo.
CREATE TABLE IF NOT EXISTS group_messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages(group_id, id DESC);

-- Ficheiros e documentos do grupo (só os membros os descarregam).
CREATE TABLE IF NOT EXISTS group_files (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  url TEXT NOT NULL,
  mime VARCHAR(120) NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_files_group_idx ON group_files(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS group_files_url_idx ON group_files(url);

-- Eventos do grupo (calendário do grupo; não aparecem na lista pública de eventos).
ALTER TABLE events ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES social_groups(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS events_group_idx ON events(group_id, starts_at);

-- Denunciar um grupo inteiro.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post','comment','user','course','group'));
