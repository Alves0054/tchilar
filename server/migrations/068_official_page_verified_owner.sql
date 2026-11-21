-- A página oficial do Tchilar só passa para uma conta depois de o email dessa conta estar confirmado.
-- Antes, o registo com o email de administração dava logo a posse (sem confirmar o email): num servidor novo,
-- quem se registasse primeiro com esse email ficava dono da página oficial.

-- Registo: só segue a página oficial. A posse fica para quando o email for confirmado.
CREATE OR REPLACE FUNCTION auto_follow_official_tchilar_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Contas criadas já confirmadas (equipa, dados de demonstração) recebem a posse logo, mas só de uma página sem dono.
  IF NEW.email_verified THEN
    UPDATE pages SET owner_id=NEW.id
    WHERE is_official AND owner_id IS NULL AND lower(admin_email)=lower(NEW.email);
  END IF;

  INSERT INTO page_followers(page_id,user_id)
  SELECT id,NEW.id FROM pages
  WHERE is_official AND owner_id IS DISTINCT FROM NEW.id
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Confirmação do email: se o email confirmado é o de administração e a página não tem dono, passa a ser dele.
CREATE OR REPLACE FUNCTION claim_official_tchilar_page() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email_verified AND (NOT OLD.email_verified OR lower(OLD.email) IS DISTINCT FROM lower(NEW.email)) THEN
    UPDATE pages SET owner_id=NEW.id
    WHERE is_official AND owner_id IS NULL AND lower(admin_email)=lower(NEW.email);

    -- Quem gere a página não aparece como seguidor dela (igual à migração 054).
    DELETE FROM page_followers f
    USING pages p
    WHERE p.is_official AND p.owner_id=NEW.id AND f.page_id=p.id AND f.user_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_claim_official_tchilar_page ON users;
CREATE TRIGGER users_claim_official_tchilar_page
AFTER UPDATE OF email_verified, email ON users
FOR EACH ROW EXECUTE FUNCTION claim_official_tchilar_page();

-- Se a página já estiver com uma conta de email por confirmar, tira-lha (volta quando o email for confirmado).
UPDATE pages p SET owner_id=NULL
FROM users u
WHERE p.is_official AND p.owner_id=u.id AND NOT u.email_verified;
