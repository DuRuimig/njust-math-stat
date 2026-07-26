PRAGMA foreign_keys = OFF;

ALTER TABLE course_comments RENAME TO course_comments_legacy;

CREATE TABLE course_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO course_comments (id, user_id, course_id, body, created_at)
SELECT id, user_id, course_id, body, created_at
FROM course_comments_legacy;

DROP TABLE course_comments_legacy;
CREATE INDEX idx_course_comments_course_created ON course_comments(course_id, created_at DESC);
PRAGMA foreign_keys = ON;
