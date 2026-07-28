PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1));
ALTER TABLE users ADD COLUMN banned_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned);
