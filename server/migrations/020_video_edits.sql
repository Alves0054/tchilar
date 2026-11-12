-- Edições não destrutivas dos vídeos (corte, velocidade, efeito, texto, som), aplicadas pelo leitor.
-- NULL = vídeo sem edição. O formato é validado no servidor (server/video-edit.js).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_edit JSONB;
