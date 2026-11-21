ALTER TABLE pages ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS admin_email VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS pages_one_official_idx ON pages(is_official) WHERE is_official;

INSERT INTO pages(owner_id,name,page_type,category,description,is_official,admin_email)
VALUES (
  (SELECT id FROM users WHERE lower(email)='oficial@tchilar.invalid' LIMIT 1),
  'Tchilar','comunidade','sociedade','Página oficial do Tchilar.',TRUE,'oficial@tchilar.invalid'
)
ON CONFLICT DO NOTHING;

INSERT INTO page_followers(page_id,user_id)
SELECT p.id,u.id
FROM pages p
CROSS JOIN users u
WHERE p.is_official AND p.owner_id IS DISTINCT FROM u.id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION auto_follow_official_tchilar_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pages SET owner_id=NEW.id
  WHERE is_official AND lower(admin_email)=lower(NEW.email);

  INSERT INTO page_followers(page_id,user_id)
  SELECT id,NEW.id FROM pages
  WHERE is_official AND owner_id IS DISTINCT FROM NEW.id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_auto_follow_official_tchilar ON users;
CREATE TRIGGER users_auto_follow_official_tchilar
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION auto_follow_official_tchilar_page();

CREATE OR REPLACE FUNCTION preserve_official_tchilar_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pages SET owner_id=NULL
  WHERE is_official AND owner_id=OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS users_preserve_official_tchilar_page ON users;
CREATE TRIGGER users_preserve_official_tchilar_page
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION preserve_official_tchilar_page();
