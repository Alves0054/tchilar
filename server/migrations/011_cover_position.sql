-- Posição vertical da capa escolhida pelo utilizador (0 = topo, 50 = centro, 100 = fundo).
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_position SMALLINT NOT NULL DEFAULT 50
  CHECK (cover_position BETWEEN 0 AND 100);
