UPDATE pages
SET owner_id=(SELECT id FROM users WHERE lower(email)='oficial@tchilar.invalid' LIMIT 1),
    admin_email='oficial@tchilar.invalid'
WHERE is_official AND lower(admin_email)='oficial@tchilar.invalid';

DELETE FROM page_followers f
USING pages p
WHERE p.is_official AND f.page_id=p.id AND f.user_id=p.owner_id;
