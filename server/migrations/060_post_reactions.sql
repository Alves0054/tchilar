ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS reaction VARCHAR(16) NOT NULL DEFAULT 'like';

ALTER TABLE likes
  DROP CONSTRAINT IF EXISTS likes_reaction_check;

ALTER TABLE likes
  ADD CONSTRAINT likes_reaction_check
  CHECK (reaction IN ('like', 'love', 'haha', 'wow', 'sad', 'angry'));
