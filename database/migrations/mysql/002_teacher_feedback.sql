CREATE TABLE IF NOT EXISTS teachers (
  id CHAR(36) PRIMARY KEY,
  directory_key VARCHAR(80) NOT NULL,
  name VARCHAR(255) NOT NULL,
  department VARCHAR(255) NULL,
  directory_link VARCHAR(1024) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teachers_directory_key (directory_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_likes (
  user_id CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, teacher_id),
  CONSTRAINT fk_teacher_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_likes_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  KEY idx_teacher_likes_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_comments (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  teacher_id CHAR(36) NOT NULL,
  body VARCHAR(300) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_teacher_comments_body_length CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 300),
  CONSTRAINT fk_teacher_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_teacher_comments_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  KEY idx_teacher_comments_teacher_created (teacher_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
