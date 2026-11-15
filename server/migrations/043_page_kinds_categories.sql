-- Páginas: 30 tipos (página pessoal, loja, banda, restaurante...) e, à parte, a área de atividade
-- (19 categorias, 12 delas com subcategorias). Converte as páginas existentes para a lista nova.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS subcategory VARCHAR(40);

UPDATE pages p SET page_type = m.new_type, category = m.new_category, subcategory = m.new_sub
FROM (VALUES
  ('negocio','restaurante','restaurante','alimentacao','restaurantes'),
  ('negocio','loja','loja','negocios','comercio'),
  ('negocio','beleza','estabelecimento','moda-beleza','cabeleireiros'),
  ('negocio','saude','estabelecimento','saude','clinicas'),
  ('negocio','servicos','servicos','negocios','servicos-profissionais'),
  ('negocio','alojamento','hotel','viagens','hoteis'),
  ('negocio','automoveis','estabelecimento','transportes',NULL),
  ('negocio','imobiliaria','empresa','imobiliario',NULL),
  ('empresa','marca','marca','negocios','empresas'),
  ('empresa','tecnologia','empresa','tecnologia','tecnologia'),
  ('empresa','moda','marca','moda-beleza',NULL),
  ('empresa','comida','marca','alimentacao',NULL),
  ('empresa','media','imprensa','comunicacao',NULL),
  ('empresa','financas','empresa','negocios',NULL),
  ('empresa','telecom','empresa','tecnologia',NULL),
  ('figura','artista','artista','arte',NULL),
  ('figura','musico','artista','musica','cantores-e-musicos'),
  ('figura','criador','criador','audiovisual',NULL),
  ('figura','atleta','figura-publica','desporto','clubes-e-atletas'),
  ('figura','jornalista','figura-publica','comunicacao','jornalistas'),
  ('figura','politica','figura-publica','sociedade',NULL),
  ('entretenimento','filmes','entretenimento','audiovisual','criadores-de-filmes'),
  ('entretenimento','eventos','evento','arte',NULL),
  ('entretenimento','programa','programa-tv','comunicacao','televisao'),
  ('entretenimento','jogos','videojogos','tecnologia','videojogos'),
  ('entretenimento','livros','entretenimento','arte','literatura'),
  ('organizacao','ong','ong','sociedade',NULL),
  ('organizacao','escola','educacao','educacao','escolas'),
  ('organizacao','religiosa','organizacao','religiao',NULL),
  ('organizacao','clube','clube','desporto','clubes-e-atletas'),
  ('organizacao','associacao','organizacao','sociedade',NULL),
  ('organizacao','publico','governamental','governo',NULL),
  ('comunidade','comunidade','comunidade','sociedade',NULL),
  ('comunidade','causa','ong','sociedade',NULL),
  ('comunidade','noticias','noticias','comunicacao','portais-de-noticias'),
  ('comunidade','fas','comunidade','arte',NULL)
) AS m(old_type, old_category, new_type, new_category, new_sub)
WHERE p.page_type = m.old_type AND p.category = m.old_category;

-- O que sobrar (valores antigos fora da lista) fica como comunidade.
UPDATE pages SET page_type='comunidade', category='sociedade', subcategory=NULL
WHERE page_type IN ('negocio','figura') OR category NOT IN ('musica','audiovisual','moda-beleza','negocios','alimentacao','desporto','educacao',
  'viagens','tecnologia','comunicacao','arte','saude','transportes','imobiliario','agricultura','sociedade','governo','religiao','familia');
ALTER TABLE pages ALTER COLUMN category SET DEFAULT 'sociedade';
CREATE INDEX IF NOT EXISTS pages_category_idx ON pages(category, subcategory);
