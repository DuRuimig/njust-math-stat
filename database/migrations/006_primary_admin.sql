PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS primary_admin_assignment (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'primary'),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
