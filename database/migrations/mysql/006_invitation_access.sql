CREATE TABLE IF NOT EXISTS invitation_groups (
  id CHAR(36) PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  code_hint VARCHAR(16) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  UNIQUE KEY uq_invitation_groups_code_hash (code_hash),
  KEY idx_invitation_groups_state (enabled, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invitation_memberships (
  user_id CHAR(36) PRIMARY KEY,
  invitation_group_id CHAR(36) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invitation_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invitation_memberships_group FOREIGN KEY (invitation_group_id) REFERENCES invitation_groups(id) ON DELETE RESTRICT,
  KEY idx_invitation_memberships_group (invitation_group_id, joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
