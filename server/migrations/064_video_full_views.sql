-- Monetização por vídeos: só conta o vídeo visto até ao fim (visualização completa), de outra pessoa, uma vez por
-- pessoa e por dia. É a soma destas visualizações em todos os vídeos do criador que conta para o Programa de Parceiros.
CREATE TABLE IF NOT EXISTS video_full_views (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (post_id, viewer_id, viewed_on)
);
CREATE INDEX IF NOT EXISTS video_full_views_day_idx ON video_full_views(viewed_on, post_id);
