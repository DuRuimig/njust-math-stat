PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  directory_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  directory_link TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teacher_likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS teacher_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teacher_comments_teacher_created
  ON teacher_comments(teacher_id, created_at DESC);
