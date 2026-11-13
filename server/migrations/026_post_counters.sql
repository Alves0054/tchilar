-- Contadores guardados na própria publicação. Antes, cada publicação do feed contava gostos,
-- comentários, partilhas e estrelas de raiz em cada pedido (quatro subconsultas por publicação).
-- Os triggers mantêm os números certos em todas as escritas, venham de onde vierem.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS star_count INTEGER NOT NULL DEFAULT 0;

-- Valores atuais.
UPDATE posts p SET
  like_count = (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id),
  comment_count = (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id),
  share_count = (SELECT COUNT(*) FROM posts sh WHERE sh.shared_post_id = p.id),
  star_count = (SELECT COALESCE(SUM(st.amount), 0) FROM star_ledger st WHERE st.post_id = p.id AND st.kind = 'gift_received');

CREATE OR REPLACE FUNCTION posts_count_likes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION posts_count_comments() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Partilhas: uma publicação com shared_post_id conta na publicação original.
CREATE OR REPLACE FUNCTION posts_count_shares() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.shared_post_id IS NOT NULL THEN
    UPDATE posts SET share_count = GREATEST(share_count - 1, 0) WHERE id = OLD.shared_post_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.shared_post_id IS NOT NULL THEN
    UPDATE posts SET share_count = share_count + 1 WHERE id = NEW.shared_post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Estrelas recebidas numa publicação (só a entrada "gift_received" conta, como antes).
CREATE OR REPLACE FUNCTION posts_count_stars() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL AND NEW.kind = 'gift_received' THEN
    UPDATE posts SET star_count = star_count + NEW.amount WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL AND OLD.kind = 'gift_received' THEN
    UPDATE posts SET star_count = GREATEST(star_count - OLD.amount, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS likes_count ON likes;
CREATE TRIGGER likes_count AFTER INSERT OR DELETE ON likes FOR EACH ROW EXECUTE FUNCTION posts_count_likes();
DROP TRIGGER IF EXISTS comments_count ON comments;
CREATE TRIGGER comments_count AFTER INSERT OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION posts_count_comments();
DROP TRIGGER IF EXISTS posts_shares_count ON posts;
CREATE TRIGGER posts_shares_count AFTER INSERT OR DELETE OR UPDATE OF shared_post_id ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_count_shares();
DROP TRIGGER IF EXISTS star_ledger_count ON star_ledger;
CREATE TRIGGER star_ledger_count AFTER INSERT OR DELETE ON star_ledger FOR EACH ROW EXECUTE FUNCTION posts_count_stars();

-- Publicações em alta: ordenar por gostos + 2 x comentários sem contar tudo.
CREATE INDEX IF NOT EXISTS posts_engagement_idx ON posts((like_count + 2 * comment_count) DESC, created_at DESC);
