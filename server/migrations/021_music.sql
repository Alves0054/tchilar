-- Músicas para os Reels.
-- is_library = TRUE: faz parte da biblioteca da Biva (escolhida pela equipa, com licença registada).
-- is_library = FALSE: música carregada por uma pessoa para os próprios vídeos (só ela a vê na lista).
-- A música não é misturada no ficheiro de vídeo: o leitor toca-a por cima (posts.video_edit.music).
CREATE TABLE IF NOT EXISTS music_tracks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL CHECK (char_length(btrim(title)) > 0),
  artist VARCHAR(100) NOT NULL DEFAULT '',
  genre VARCHAR(20) NOT NULL DEFAULT 'outro',
  audio_url TEXT NOT NULL UNIQUE,
  duration_seconds NUMERIC(7,2) NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 900),
  license VARCHAR(300) NOT NULL DEFAULT '',
  is_library BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rights_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hidden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS music_tracks_library_idx ON music_tracks(created_at DESC) WHERE is_library AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS music_tracks_owner_idx ON music_tracks(uploaded_by, created_at DESC);
-- Para contar em quantos vídeos cada música foi usada.
CREATE INDEX IF NOT EXISTS posts_music_idx ON posts(((video_edit->'music'->>'trackId')::int)) WHERE video_edit ? 'music';
