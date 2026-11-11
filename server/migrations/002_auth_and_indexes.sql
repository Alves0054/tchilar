CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens(user_id,purpose);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user_created_at_idx ON posts(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS comments_post_created_at_idx ON comments(post_id,created_at);
CREATE INDEX IF NOT EXISTS messages_sender_created_at_idx ON messages(sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS messages_receiver_created_at_idx ON messages(receiver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair
  ON friend_requests(LEAST(requester_id,addressee_id), GREATEST(requester_id,addressee_id))
  WHERE status='pending';
