ALTER TABLE users
  ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN banned_at TIMESTAMP NULL,
  ADD KEY idx_users_banned (is_banned);
