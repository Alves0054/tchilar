-- Visitas ao perfil: uma por visitante (com sessão iniciada) e por dia.
CREATE TABLE IF NOT EXISTS profile_views (
  profile_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (profile_id, viewer_id, viewed_on)
);
CREATE INDEX IF NOT EXISTS profile_views_profile_day_idx ON profile_views(profile_id, viewed_on);

ALTER TABLE follows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
