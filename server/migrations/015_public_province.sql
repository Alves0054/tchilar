-- A província é privada (só para segmentação). Só aparece no marketplace de marcas
-- se a própria pessoa o autorizar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_province_to_brands BOOLEAN NOT NULL DEFAULT FALSE;
