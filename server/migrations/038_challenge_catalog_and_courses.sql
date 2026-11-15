-- Desafios mensais com catálogo de modelos e prémios por lugar (estrelas e dinheiro), e a venda de cursos
-- na Academia Tchilar.

-- ----- Desafios -----
CREATE TABLE IF NOT EXISTS challenge_templates (
  id SERIAL PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 5),
  category VARCHAR(40) NOT NULL DEFAULT 'geral',
  title VARCHAR(100) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  prizes JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO challenge_templates(code,level,category,title,description,prizes,sort) VALUES
  ('bom-dia-angola',1,'foto','Bom dia, Angola','Publica a vista da tua janela ou da tua rua de manhã. Mostra como acorda o teu bairro.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,1),
  ('o-meu-prato',1,'comida','O meu prato preferido','Fotografa o teu prato angolano favorito (funge, muamba, calulu...) e conta onde se come melhor.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,2),
  ('selfie-com-sorriso',1,'foto','Selfie com sorriso','Uma selfie a sorrir e uma frase sobre o que te deixou feliz esta semana.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,3),
  ('pet-do-mes',1,'foto','O meu animal de estimação','Mostra o teu cão, gato ou outro companheiro. Diz-nos o nome e a mania mais engraçada.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,4),
  ('por-do-sol',1,'foto','Pôr do sol','O pôr do sol mais bonito que conseguires apanhar este mês, em qualquer ponto do país.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,5),
  ('frase-do-mes',1,'comunidade','Frase que me inspira','Partilha uma frase (tua, de um mais-velho ou de um livro) que te dá força. Explica porquê.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,6),
  ('o-meu-cantinho',1,'foto','O meu cantinho','O sítio da casa ou do bairro onde gostas mais de estar. Uma foto e duas linhas.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,7),
  ('throwback',1,'foto','Foto antiga','Uma foto tua de há mais de 5 anos. Conta o que mudou desde então.','[{"place":1,"stars":50,"cashKz":0},{"place":2,"stars":30,"cashKz":0},{"place":3,"stars":20,"cashKz":0}]'::jsonb,8),
  ('kizomba-15s',2,'dança','Kizomba em 15 segundos','Um Reel de 15 segundos a dançar kizomba, semba ou kuduro. Sozinho, a par ou em grupo.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,9),
  ('receita-rapida',2,'comida','Receita em 1 minuto','Ensina uma receita simples num vídeo de até 1 minuto: ingredientes, passos e o prato final.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,10),
  ('look-do-dia',2,'moda','Look do dia','Mostra o teu look com um tecido africano ou uma peça feita em Angola. Diz onde compraste.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,11),
  ('piada-curta',2,'comédia','Piada de 30 segundos','Um vídeo curto com uma piada ou uma situação do dia a dia angolano. Respeito acima de tudo.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,12),
  ('mercado-cores',2,'foto','Cores do mercado','Fotografa as cores de um mercado (Roque, São Paulo, Kikolo ou o da tua terra), com autorização de quem aparece.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,13),
  ('desporto-de-rua',2,'desporto','Desporto de rua','Futebol de rua, basquete, capoeira ou corrida: mostra a tua modalidade num vídeo ou foto em ação.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,14),
  ('antes-depois',2,'criatividade','Antes e depois','Mostra a transformação de algo: um quarto arrumado, um penteado, um móvel restaurado.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,15),
  ('lingua-nacional',2,'cultura','Uma palavra em língua nacional','Ensina uma palavra ou expressão em umbundu, kimbundu, kikongo, chokwe ou outra língua nacional.','[{"place":1,"stars":100,"cashKz":0},{"place":2,"stars":60,"cashKz":0},{"place":3,"stars":40,"cashKz":0}]'::jsonb,16),
  ('mini-documentario',3,'vídeo','Mini-documentário do bairro','Um vídeo de até 3 minutos sobre uma pessoa, um ofício ou uma história do teu bairro.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,17),
  ('cover-musical',3,'música','Cover acústico','Canta ou toca uma música angolana em versão acústica. Indica o artista original.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,18),
  ('tutorial-util',3,'educação','Tutorial útil','Ensina algo prático em vídeo: poupar dinheiro, usar o Multicaixa Express, cuidar das plantas...','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,19),
  ('fotografia-preto-branco',3,'foto','Angola a preto e branco','Uma série de 3 fotos a preto e branco com um tema à tua escolha. Usa o efeito P&B do Tchilar.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,20),
  ('desafio-coreografia',3,'dança','Coreografia original','Cria uma coreografia original para uma música angolana e publica o Reel. Outros podem copiar!','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,21),
  ('empreendedor',3,'empreender','O meu negócio','Apresenta o teu negócio ou projeto em 1 minuto: o que fazes, para quem e como te encontrar.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,22),
  ('poesia-falada',3,'cultura','Poesia falada','Recita um poema teu (ou de um poeta angolano, com crédito) em vídeo.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,23),
  ('natureza-viva',3,'natureza','Natureza viva','Fotografa ou filma a natureza angolana: Kalandula, Tundavala, praias, florestas, animais.','[{"place":1,"stars":250,"cashKz":0},{"place":2,"stars":150,"cashKz":0},{"place":3,"stars":100,"cashKz":0}]'::jsonb,24),
  ('curta-metragem',4,'vídeo','Curta-metragem de 3 minutos','Uma história completa (início, meio e fim) em até 3 minutos. Ficção ou realidade.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,25),
  ('musica-original',4,'música','Música original','Publica uma música tua, original, com letra. Pode ser em português ou numa língua nacional.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,26),
  ('serie-fotografica',4,'foto','Série fotográfica','5 fotos que contam uma história. Escreve a legenda de cada uma no texto da publicação.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,27),
  ('impacto-comunidade',4,'comunidade','Ação na comunidade','Mostra uma ação solidária que fizeste ou organizaste: limpeza, doação, aulas grátis...','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,28),
  ('moda-sustentavel',4,'moda','Moda sustentável','Cria um look com roupa reaproveitada ou feita por ti. Mostra o processo.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,29),
  ('chef-angolano',4,'comida','Chef angolano','Recria um prato tradicional com um toque moderno. Vídeo do processo e prato final.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,30),
  ('professor-por-um-dia',4,'educação','Professor por um dia','Uma aula de até 5 minutos sobre um tema que dominas. Clara, útil e com exemplos.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,31),
  ('viagem-angola',4,'viagem','Viagem por Angola','Mostra uma viagem por uma província: o que ver, onde comer e quanto custa.','[{"place":1,"stars":500,"cashKz":5000},{"place":2,"stars":300,"cashKz":2500},{"place":3,"stars":200,"cashKz":0}]'::jsonb,32),
  ('criador-do-mes',5,'criador','Criador do mês','A tua melhor publicação do mês, em qualquer formato. A comunidade decide com os gostos.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,33),
  ('videoclipe',5,'música','Videoclipe','Grava um videoclipe para uma música tua ou de um artista angolano (com autorização).','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,34),
  ('documentario-cultural',5,'cultura','Documentário cultural','Até 5 minutos sobre uma tradição angolana: festas, artesanato, gastronomia, música.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,35),
  ('startup-angola',5,'empreender','Ideia que muda Angola','Apresenta uma ideia ou projeto que resolve um problema real do país. Explica como funciona.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,36),
  ('campeao-danca',5,'dança','Campeonato de dança','A tua melhor atuação de dança do ano, em vídeo. Solo ou grupo.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,37),
  ('humor-do-ano',5,'comédia','Humor do ano','O teu melhor sketch de humor, até 3 minutos, com respeito e criatividade.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,38),
  ('fotografo-do-ano',5,'foto','Fotógrafo do mês','A tua melhor fotografia, tirada este mês. Conta a história por trás dela.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,39),
  ('influencia-positiva',5,'comunidade','Influência positiva','Mostra como usas as redes para ajudar outras pessoas. Pode ser uma série de publicações resumida num vídeo.','[{"place":1,"stars":1000,"cashKz":25000},{"place":2,"stars":500,"cashKz":10000},{"place":3,"stars":300,"cashKz":5000}]'::jsonb,40)
ON CONFLICT (code) DO NOTHING;

-- Desafios lançados a partir de um modelo: prémios por lugar e só contam publicações feitas durante o desafio.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES challenge_templates(id) ON DELETE SET NULL;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS level SMALLINT;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS prizes JSONB;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS new_posts_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE challenges ALTER COLUMN sponsor SET DEFAULT 'Tchilar';

-- Prémios atribuídos ao encerrar. O dinheiro (cash_kz) entra no saldo do vencedor (levantamentos).
CREATE TABLE IF NOT EXISTS challenge_awards (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  place SMALLINT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  stars INTEGER NOT NULL DEFAULT 0 CHECK (stars >= 0),
  cash_kz NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_kz >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (challenge_id, place)
);
CREATE INDEX IF NOT EXISTS challenge_awards_user_idx ON challenge_awards(user_id);

-- ----- Academia: cursos -----
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  by_team BOOLEAN NOT NULL DEFAULT FALSE,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(240) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category VARCHAR(40) NOT NULL DEFAULT 'geral',
  level VARCHAR(20) NOT NULL DEFAULT 'iniciante' CHECK (level IN ('iniciante','intermedio','avancado')),
  cover_url TEXT,
  price_kz NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_kz = 0 OR price_kz BETWEEN 500 AND 500000),
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','rejected','hidden')),
  review_note VARCHAR(500),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS courses_status_idx ON courses(status, published_at DESC);
CREATE INDEX IF NOT EXISTS courses_owner_idx ON courses(owner_id);

CREATE TABLE IF NOT EXISTS course_lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title VARCHAR(120) NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  video_url TEXT,
  is_preview BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS course_lessons_course_idx ON course_lessons(course_id, position);

CREATE TABLE IF NOT EXISTS course_purchases (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  by_team BOOLEAN NOT NULL DEFAULT FALSE,
  amount_kz NUMERIC(12,2) NOT NULL CHECK (amount_kz > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  paid_at TIMESTAMPTZ,
  refund_status VARCHAR(20) CHECK (refund_status IN ('refunded','manual','failed','not_needed')),
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS course_purchases_user_idx ON course_purchases(user_id, course_id) WHERE status='paid';
CREATE INDEX IF NOT EXISTS course_purchases_owner_idx ON course_purchases(owner_id) WHERE status='paid';
