-- Bilhetes vendidos antes de haver «quem vende»: o recibo passa a indicar quem organizou o evento
-- (e não o Tchilar). Usa o nome da página, se o evento era de uma página, ou o nome de quem o criou.
UPDATE event_tickets t
SET seller_name = COALESCE(NULLIF(e.seller_name, ''), p.name, u.display_name, u.username),
    seller_nif = COALESCE(t.seller_nif, NULLIF(e.seller_nif, '')),
    seller_address = COALESCE(t.seller_address, NULLIF(e.seller_address, ''))
FROM events e
LEFT JOIN pages p ON p.id = e.page_id
LEFT JOIN users u ON u.id = e.creator_id
WHERE t.event_id = e.id AND (t.seller_name IS NULL OR t.seller_name = '');
