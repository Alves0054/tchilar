-- Índices em falta encontrados na auditoria. Sem eles, estas consultas percorrem a tabela inteira:
--  * contar gostos de cada publicação do feed (a chave de likes começa por user_id);
--  * quem segue alguém (seguidores, avisos de diretos, mensagens "só quem sigo");
--  * grupos e páginas de uma pessoa (feed "a seguir");
--  * cada foto/vídeo pedido em /uploads (procura o ficheiro em posts, stories, users, ads e músicas).
-- Nota: as migrações correm numa transação, por isso não se usa CONCURRENTLY. Numa base de dados
-- grande em produção, cria-os antes à mão com CREATE INDEX CONCURRENTLY e esta migração passa por cima.
CREATE INDEX IF NOT EXISTS likes_post_idx ON likes(post_id);
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows(following_id);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);
CREATE INDEX IF NOT EXISTS page_followers_user_idx ON page_followers(user_id);
CREATE INDEX IF NOT EXISTS posts_media_url_idx ON posts(media_url) WHERE media_url <> '';
CREATE INDEX IF NOT EXISTS stories_media_url_idx ON stories(media_url);
CREATE INDEX IF NOT EXISTS users_avatar_url_idx ON users(avatar_url) WHERE avatar_url <> '';
CREATE INDEX IF NOT EXISTS users_cover_url_idx ON users(cover_url) WHERE cover_url <> '';
CREATE INDEX IF NOT EXISTS ads_image_url_idx ON ads(image_url) WHERE image_url IS NOT NULL AND image_url <> '';
CREATE INDEX IF NOT EXISTS music_tracks_audio_url_idx ON music_tracks(audio_url);
CREATE INDEX IF NOT EXISTS posts_group_idx ON posts(group_id, created_at DESC) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_page_idx ON posts(page_id, created_at DESC) WHERE page_id IS NOT NULL;
