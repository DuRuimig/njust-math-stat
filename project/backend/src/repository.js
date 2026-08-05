function createRepository(db) {
  if (db.kind === 'mysql') return createMysqlRepository(db);
  return createSqliteRepository(db);
}

const adminRoleId = 'b2ab8a66-7151-4f49-9bf0-e4beeb3f5ea3';
const insertAuditSql = 'INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id) VALUES (?, ?, ?, ?, ?)';
const invitationGroupColumns = 'id, label, code_hash, code_hint, enabled, expires_at, created_at, revoked_at';
const invitationGroupQualifiedColumns = invitationGroupColumns.split(', ').map((column) => `g.${column}`).join(', ');
const invitationGroupGroupBy = invitationGroupColumns.split(', ').map((column) => `g.${column}`).join(', ');

function isUserAccountUniqueConflict(error) {
  if (!error) return false;
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'ER_DUP_ENTRY') return true;
  return error.code === 'SQLITE_CONSTRAINT' && /users\.account_id/i.test(error.message || '');
}

function createSqliteRepository(db) {
  const one = (sql, ...params) => Promise.resolve(db.prepare(sql).get(...params));
  const many = (sql, ...params) => Promise.resolve(db.prepare(sql).all(...params));
  const run = (sql, ...params) => Promise.resolve(db.prepare(sql).run(...params));
  const operations = createRepositoryOperations({
    one,
    many,
    run,
    nowPlusSevenDays: "datetime('now', '+7 days')",
    insertIgnore: 'ON CONFLICT(user_id, TARGET_ID) DO NOTHING',
    membershipInsert: 'INSERT OR IGNORE INTO invitation_memberships (user_id, invitation_group_id) VALUES (?, ?)',
  });
  return { ...operations, ...createSqliteAdministrativeOperations(db) };
}

function createMysqlRepository(db) {
  const one = async (sql, ...params) => (await db.execute(sql, params))[0][0];
  const many = async (sql, ...params) => (await db.execute(sql, params))[0];
  const run = async (sql, ...params) => {
    const [result] = await db.execute(sql, params);
    return { changes: result.affectedRows };
  };
  const operations = createRepositoryOperations({
    one,
    many,
    run,
    nowPlusSevenDays: 'DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY)',
    insertIgnore: 'ON DUPLICATE KEY UPDATE user_id = user_id',
    membershipInsert: 'INSERT INTO invitation_memberships (user_id, invitation_group_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
  });
  return { ...operations, ...createMysqlAdministrativeOperations(db) };
}

function createSqliteAdministrativeOperations(db) {
  const statements = () => ({
    insertRole: db.prepare('INSERT OR IGNORE INTO roles (id, role_key, description) VALUES (?, ?, ?)'),
    insertUserRole: db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)'),
    insertPrimary: db.prepare("INSERT OR IGNORE INTO primary_admin_assignment (singleton_key, user_id) VALUES ('primary', ?)"),
    primary: db.prepare("SELECT user_id FROM primary_admin_assignment WHERE singleton_key = 'primary'"),
    user: db.prepare('SELECT id, account_id, is_banned FROM users WHERE id = ?'),
    hasAdminRole: db.prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?'),
    insertAudit: db.prepare(insertAuditSql),
  });

  const ensureInitial = (userId) => {
    const statement = statements();
    statement.insertRole.run(adminRoleId, 'admin', '体验版管理员');
    statement.insertPrimary.run(userId);
    const assigned = statement.primary.get();
    const ownsAssignment = assigned.user_id === userId;
    if (ownsAssignment) statement.insertUserRole.run(userId, adminRoleId);
    return { assigned: ownsAssignment, userId: assigned.user_id };
  };

  const setBanned = (actorUserId, targetUserId, banned, auditId) => {
    const statement = statements();
    const assigned = statement.primary.get();
    const actorIsPrimary = assigned && assigned.user_id === actorUserId;
    if (!actorIsPrimary && !statement.hasAdminRole.get(actorUserId, adminRoleId)) return { actorNotAdmin: true };
    const target = statement.user.get(targetUserId);
    if (!target) return { missing: true };
    if (banned && targetUserId === actorUserId) return { selfBan: true };
    const targetIsAdmin = Boolean(statement.hasAdminRole.get(targetUserId, adminRoleId)) || Boolean(assigned && assigned.user_id === targetUserId);
    if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
    db.prepare('UPDATE users SET is_banned = ?, banned_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(banned ? 1 : 0, banned ? 1 : 0, targetUserId);
    if (banned) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
    statement.insertAudit.run(auditId, actorUserId, banned ? 'ban_user' : 'unban_user', 'user', targetUserId);
    return { updated: true };
  };

  const deleteUser = (actorUserId, targetUserId, auditId) => {
    const statement = statements();
    const assigned = statement.primary.get();
    const actorIsPrimary = assigned && assigned.user_id === actorUserId;
    if (!actorIsPrimary && !statement.hasAdminRole.get(actorUserId, adminRoleId)) return { actorNotAdmin: true };
    const target = statement.user.get(targetUserId);
    if (!target) return { missing: true };
    if (targetUserId === actorUserId) return { selfDelete: true };
    const targetIsAdmin = Boolean(statement.hasAdminRole.get(targetUserId, adminRoleId)) || Boolean(assigned && assigned.user_id === targetUserId);
    if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
    if (assigned && assigned.user_id === targetUserId) return { primaryAdmin: true };
    db.prepare('DELETE FROM admin_audit_logs WHERE actor_user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
    statement.insertAudit.run(auditId, actorUserId, 'delete_user', 'user', targetUserId);
    return { deleted: true };
  };

  const setAdminRole = (actorUserId, targetUserId, isAdmin, auditId) => {
    const statement = statements();
    const assigned = statement.primary.get();
    if (!assigned || assigned.user_id !== actorUserId) return { actorNotPrimary: true };
    const target = statement.user.get(targetUserId);
    if (!target) return { missing: true };
    if (target.is_banned) return { banned: true };
    if (targetUserId === actorUserId) return { selfRole: true };
    if (!isAdmin && assigned.user_id === targetUserId) return { primaryAdmin: true };
    statement.insertRole.run(adminRoleId, 'admin', '体验版管理员');
    if (isAdmin) statement.insertUserRole.run(targetUserId, adminRoleId);
    else db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(targetUserId, adminRoleId);
    statement.insertAudit.run(auditId, actorUserId, isAdmin ? 'grant_admin_role' : 'revoke_admin_role', 'user', targetUserId);
    return { updated: true };
  };

  const updateIdentity = (actorUserId, targetUserId, name, studentNumber, accountId, auditId) => {
    const statement = statements();
    const assigned = statement.primary.get();
    const actorIsPrimary = assigned && assigned.user_id === actorUserId;
    if (!actorIsPrimary && !statement.hasAdminRole.get(actorUserId, adminRoleId)) return { actorNotAdmin: true };
    const target = statement.user.get(targetUserId);
    if (!target) return { missing: true };
    const targetIsAdmin = Boolean(statement.hasAdminRole.get(targetUserId, adminRoleId)) || Boolean(assigned && assigned.user_id === targetUserId);
    if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
    const existing = db.prepare('SELECT id FROM users WHERE student_number = ? AND id <> ?').get(studentNumber, targetUserId);
    if (existing) return { conflict: true };
    db.prepare("UPDATE users SET account_id = CASE WHEN account_id LIKE 'test-identity:%' THEN ? ELSE account_id END, legal_name = ?, student_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(accountId, name, studentNumber, targetUserId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
    statement.insertAudit.run(auditId, actorUserId, 'update_identity', 'user', targetUserId);
    return { updated: true };
  };

  const transferPrimary = (actorUserId, targetUserId, auditId) => {
    const statement = statements();
    const assigned = statement.primary.get();
    if (!assigned) return { missingAssignment: true };
    if (assigned.user_id !== actorUserId) return { actorNotPrimary: true };
    if (targetUserId === actorUserId) return { alreadyAssigned: true };
    const target = statement.user.get(targetUserId);
    if (!target) return { missing: true };
    if (target.is_banned) return { banned: true };
    statement.insertRole.run(adminRoleId, 'admin', '体验版管理员');
    statement.insertUserRole.run(targetUserId, adminRoleId);
    db.prepare("UPDATE primary_admin_assignment SET user_id = ?, assigned_at = CURRENT_TIMESTAMP WHERE singleton_key = 'primary'").run(targetUserId);
    statement.insertAudit.run(auditId, actorUserId, 'transfer_primary_admin', 'user', targetUserId);
    return { updated: true };
  };

  const runTransaction = (work, args) => {
    if (typeof db.transaction !== 'function') throw new Error('SQLite administrative operations require transaction support');
    return db.transaction(work)(...args);
  };

  return {
    ensureInitialPrimaryAdmin: (...args) => Promise.resolve(runTransaction(ensureInitial, args)),
    adminSetUserBanned: (...args) => Promise.resolve(runTransaction(setBanned, args)),
    adminDeleteUser: (...args) => Promise.resolve(runTransaction(deleteUser, args)),
    adminSetUserRole: (...args) => Promise.resolve(runTransaction(setAdminRole, args)),
    adminUpdateIdentity: (...args) => Promise.resolve(runTransaction(updateIdentity, args)),
    transferPrimaryAdmin: (...args) => Promise.resolve(runTransaction(transferPrimary, args)),
  };
}

async function withMysqlTransaction(db, work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function createMysqlAdministrativeOperations(db) {
  const primaryForUpdate = async (connection) => (await connection.execute("SELECT user_id FROM primary_admin_assignment WHERE singleton_key = 'primary' FOR UPDATE"))[0][0];
  const userForUpdate = async (connection, userId) => (await connection.execute('SELECT id, is_banned FROM users WHERE id = ? FOR UPDATE', [userId]))[0][0];
  const hasAdminRole = async (connection, userId) => Boolean((await connection.execute('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? FOR UPDATE', [userId, adminRoleId]))[0][0]);
  const insertRole = (connection) => connection.execute('INSERT INTO roles (id, role_key, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role_key = role_key', [adminRoleId, 'admin', '体验版管理员']);
  const insertUserRole = (connection, userId) => connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId, adminRoleId]);

  return {
    ensureInitialPrimaryAdmin: (userId) => withMysqlTransaction(db, async (connection) => {
      await connection.execute("INSERT INTO primary_admin_assignment (singleton_key, user_id) VALUES ('primary', ?) ON DUPLICATE KEY UPDATE singleton_key = singleton_key", [userId]);
      const assigned = await primaryForUpdate(connection);
      const ownsAssignment = assigned.user_id === userId;
      if (ownsAssignment) {
        await insertRole(connection);
        await insertUserRole(connection, userId);
      }
      return { assigned: ownsAssignment, userId: assigned.user_id };
    }),
    adminSetUserBanned: (actorUserId, targetUserId, banned, auditId) => withMysqlTransaction(db, async (connection) => {
      const assigned = await primaryForUpdate(connection);
      const actorIsPrimary = assigned && assigned.user_id === actorUserId;
      if (!actorIsPrimary && !await hasAdminRole(connection, actorUserId)) return { actorNotAdmin: true };
      const target = await userForUpdate(connection, targetUserId);
      if (!target) return { missing: true };
      if (banned && targetUserId === actorUserId) return { selfBan: true };
      const targetIsAdmin = await hasAdminRole(connection, targetUserId) || Boolean(assigned && assigned.user_id === targetUserId);
      if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
      await connection.execute('UPDATE users SET is_banned = ?, banned_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [banned ? 1 : 0, banned ? 1 : 0, targetUserId]);
      if (banned) await connection.execute('DELETE FROM sessions WHERE user_id = ?', [targetUserId]);
      await connection.execute(insertAuditSql, [auditId, actorUserId, banned ? 'ban_user' : 'unban_user', 'user', targetUserId]);
      return { updated: true };
    }),
    adminDeleteUser: (actorUserId, targetUserId, auditId) => withMysqlTransaction(db, async (connection) => {
      const assigned = await primaryForUpdate(connection);
      const actorIsPrimary = assigned && assigned.user_id === actorUserId;
      if (!actorIsPrimary && !await hasAdminRole(connection, actorUserId)) return { actorNotAdmin: true };
      const target = await userForUpdate(connection, targetUserId);
      if (!target) return { missing: true };
      if (targetUserId === actorUserId) return { selfDelete: true };
      const targetIsAdmin = await hasAdminRole(connection, targetUserId) || Boolean(assigned && assigned.user_id === targetUserId);
      if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
      if (assigned && assigned.user_id === targetUserId) return { primaryAdmin: true };
      await connection.execute('DELETE FROM admin_audit_logs WHERE actor_user_id = ?', [targetUserId]);
      await connection.execute('DELETE FROM users WHERE id = ?', [targetUserId]);
      await connection.execute(insertAuditSql, [auditId, actorUserId, 'delete_user', 'user', targetUserId]);
      return { deleted: true };
    }),
    adminSetUserRole: (actorUserId, targetUserId, isAdmin, auditId) => withMysqlTransaction(db, async (connection) => {
      const assigned = await primaryForUpdate(connection);
      if (!assigned || assigned.user_id !== actorUserId) return { actorNotPrimary: true };
      const target = await userForUpdate(connection, targetUserId);
      if (!target) return { missing: true };
      if (target.is_banned) return { banned: true };
      if (targetUserId === actorUserId) return { selfRole: true };
      if (!isAdmin && assigned.user_id === targetUserId) return { primaryAdmin: true };
      await insertRole(connection);
      if (isAdmin) await insertUserRole(connection, targetUserId);
      else await connection.execute('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [targetUserId, adminRoleId]);
      await connection.execute(insertAuditSql, [auditId, actorUserId, isAdmin ? 'grant_admin_role' : 'revoke_admin_role', 'user', targetUserId]);
      return { updated: true };
    }),
    adminUpdateIdentity: (actorUserId, targetUserId, name, studentNumber, accountId, auditId) => withMysqlTransaction(db, async (connection) => {
      const assigned = await primaryForUpdate(connection);
      const actorIsPrimary = assigned && assigned.user_id === actorUserId;
      if (!actorIsPrimary && !await hasAdminRole(connection, actorUserId)) return { actorNotAdmin: true };
      const target = await userForUpdate(connection, targetUserId);
      if (!target) return { missing: true };
      const targetIsAdmin = await hasAdminRole(connection, targetUserId) || Boolean(assigned && assigned.user_id === targetUserId);
      if (targetIsAdmin && !actorIsPrimary) return { protectedAdmin: true };
      const existing = (await connection.execute('SELECT id FROM users WHERE student_number = ? AND id <> ? FOR UPDATE', [studentNumber, targetUserId]))[0][0];
      if (existing) return { conflict: true };
      try {
        await connection.execute("UPDATE users SET account_id = CASE WHEN account_id LIKE 'test-identity:%' THEN ? ELSE account_id END, legal_name = ?, student_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [accountId, name, studentNumber, targetUserId]);
      } catch (error) {
        if (isUserAccountUniqueConflict(error)) return { conflict: true };
        throw error;
      }
      await connection.execute('DELETE FROM sessions WHERE user_id = ?', [targetUserId]);
      await connection.execute(insertAuditSql, [auditId, actorUserId, 'update_identity', 'user', targetUserId]);
      return { updated: true };
    }),
    transferPrimaryAdmin: (actorUserId, targetUserId, auditId) => withMysqlTransaction(db, async (connection) => {
      const assigned = await primaryForUpdate(connection);
      if (!assigned) return { missingAssignment: true };
      if (assigned.user_id !== actorUserId) return { actorNotPrimary: true };
      if (targetUserId === actorUserId) return { alreadyAssigned: true };
      const target = await userForUpdate(connection, targetUserId);
      if (!target) return { missing: true };
      if (target.is_banned) return { banned: true };
      await insertRole(connection);
      await insertUserRole(connection, targetUserId);
      await connection.execute("UPDATE primary_admin_assignment SET user_id = ?, assigned_at = CURRENT_TIMESTAMP WHERE singleton_key = 'primary'", [targetUserId]);
      await connection.execute(insertAuditSql, [auditId, actorUserId, 'transfer_primary_admin', 'user', targetUserId]);
      return { updated: true };
    }),
  };
}

function createRepositoryOperations({ one, many, run, nowPlusSevenDays, insertIgnore, membershipInsert }) {
  const targetSql = (type) => ({ table: `${type}s`, key: type === 'course' ? 'stable_key' : 'directory_key', column: `${type}_id` });
  return {
    findSession: (hash) => one(`SELECT u.id, u.account_id, u.nickname, u.avatar_url, u.legal_name, u.student_number FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_banned = 0`, hash),
    findTarget: (type, key) => {
      const target = targetSql(type);
      return one(`SELECT id, ${target.key} AS target_key FROM ${target.table} WHERE ${target.key} = ?`, key);
    },
    feedback: async (type, targetId, userId) => {
      const target = targetSql(type);
      const likeCount = Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes l JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE l.${target.column} = ?`, targetId)).count);
      const comments = await many(`SELECT c.id, c.user_id, c.body, c.created_at, u.nickname AS author_nickname FROM ${type}_comments c JOIN users u ON u.id = c.user_id AND u.is_banned = 0 WHERE c.${target.column} = ? ORDER BY c.created_at DESC`, targetId);
      const liked = userId ? Boolean(await one(`SELECT 1 FROM ${type}_likes l JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE l.user_id = ? AND l.${target.column} = ?`, userId, targetId)) : false;
      return { likeCount, liked, comments };
    },
    like: async (type, userId, targetId) => {
      const target = targetSql(type);
      const result = await run(`INSERT INTO ${type}_likes (user_id, ${target.column}) VALUES (?, ?) ${insertIgnore.replace('TARGET_ID', target.column)}`, userId, targetId);
      const likeCount = Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes l JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE l.${target.column} = ?`, targetId)).count);
      return { created: Boolean(result.changes), likeCount };
    },
    unlike: async (type, userId, targetId) => {
      const target = targetSql(type);
      await run(`DELETE FROM ${type}_likes WHERE user_id = ? AND ${target.column} = ?`, userId, targetId);
      return Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes l JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE l.${target.column} = ?`, targetId)).count);
    },
    canComment: (type, userId, targetId) => one(`SELECT 1 FROM ${type}_likes WHERE user_id = ? AND ${type}_id = ?`, userId, targetId),
    createComment: async (type, id, userId, targetId, body) => {
      await run(`INSERT INTO ${type}_comments (id, user_id, ${type}_id, body) VALUES (?, ?, ?, ?)`, id, userId, targetId, body);
      return one(`SELECT c.id, c.user_id, c.body, c.created_at, u.nickname AS author_nickname FROM ${type}_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`, id);
    },
    findComment: (type, commentId, targetId) => one(`SELECT id, user_id FROM ${type}_comments WHERE id = ? AND ${type}_id = ?`, commentId, targetId),
    deleteComment: (type, commentId, targetId) => run(`DELETE FROM ${type}_comments WHERE id = ? AND ${type}_id = ?`, commentId, targetId),
    teacherSummary: async (keys, userId) => {
      if (!keys.length) return [];
      const placeholders = keys.map(() => '?').join(', ');
      const rows = await many(`SELECT t.directory_key AS teacherId, COUNT(u.id) AS likeCount FROM teachers t LEFT JOIN teacher_likes l ON l.teacher_id = t.id LEFT JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE t.directory_key IN (${placeholders}) GROUP BY t.id, t.directory_key ORDER BY t.directory_key`, ...keys);
      const liked = userId ? new Set((await many(`SELECT t.directory_key FROM teachers t JOIN teacher_likes l ON l.teacher_id = t.id JOIN users u ON u.id = l.user_id AND u.is_banned = 0 WHERE l.user_id = ? AND t.directory_key IN (${placeholders})`, userId, ...keys)).map((row) => row.directory_key)) : null;
      return rows.map((row) => ({ teacherId: row.teacherId, likeCount: Number(row.likeCount), ...(liked ? { likedByMe: liked.has(row.teacherId) } : {}) }));
    },
    allTeacherKeys: () => many('SELECT directory_key FROM teachers ORDER BY directory_key'),
    findUserByAccount: (accountId) => one('SELECT id, is_banned FROM users WHERE account_id = ?', accountId),
    isInvited: async (userId) => Boolean(await one('SELECT 1 FROM invitation_memberships WHERE user_id = ?', userId)),
    invitationStatus: async (userId) => one(`SELECT g.id, g.label, g.enabled, g.expires_at, m.joined_at FROM invitation_memberships m JOIN invitation_groups g ON g.id = m.invitation_group_id WHERE m.user_id = ?`, userId),
    findInvitationByHash: (codeHash) => one(`SELECT ${invitationGroupColumns} FROM invitation_groups WHERE code_hash = ?`, codeHash),
    joinInvitation: async (userId, groupId) => {
      const result = await run(membershipInsert, userId, groupId);
      return { created: Boolean(result.changes) };
    },
    listInvitationGroups: async () => many(`SELECT ${invitationGroupQualifiedColumns}, COUNT(m.user_id) AS member_count FROM invitation_groups g LEFT JOIN invitation_memberships m ON m.invitation_group_id = g.id GROUP BY ${invitationGroupGroupBy} ORDER BY g.created_at DESC`),
    createInvitationGroup: (id, label, codeHash, codeHint, enabled, expiresAt) => run('INSERT INTO invitation_groups (id, label, code_hash, code_hint, enabled, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id, label, codeHash, codeHint, enabled ? 1 : 0, expiresAt || null),
    updateInvitationGroup: async (id, fields) => {
      const sets = [];
      const params = [];
      if (fields.label !== undefined) { sets.push('label = ?'); params.push(fields.label); }
      if (fields.enabled !== undefined) { sets.push('enabled = ?'); params.push(fields.enabled ? 1 : 0); sets.push('revoked_at = CASE WHEN ? THEN NULL ELSE COALESCE(revoked_at, CURRENT_TIMESTAMP) END'); params.push(fields.enabled ? 1 : 0); }
      if (fields.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(fields.expiresAt || null); }
      if (fields.codeHash !== undefined) { sets.push('code_hash = ?'); params.push(fields.codeHash); sets.push('code_hint = ?'); params.push(fields.codeHint); }
      if (!sets.length) return one(`SELECT ${invitationGroupColumns} FROM invitation_groups WHERE id = ?`, id);
      params.push(id);
      await run(`UPDATE invitation_groups SET ${sets.join(', ')} WHERE id = ?`, ...params);
      return one(`SELECT ${invitationGroupColumns} FROM invitation_groups WHERE id = ?`, id);
    },
    createUser: (id, accountId) => run('INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)', id, accountId, '新同学'),
    findOrCreateTestIdentity: async (accountId, id, name, studentNumber) => {
      const existing = await one('SELECT id, legal_name, student_number, is_banned FROM users WHERE account_id = ?', accountId);
      if (existing) return existing;

      const candidate = { id, legal_name: name, student_number: studentNumber, is_banned: 0 };
      try {
        await run('INSERT INTO users (id, account_id, nickname, legal_name, student_number) VALUES (?, ?, ?, ?, ?)', candidate.id, accountId, '新同学', name, studentNumber);
        return candidate;
      } catch (error) {
        if (!isUserAccountUniqueConflict(error)) throw error;
        const concurrentUser = await one('SELECT id, legal_name, student_number, is_banned FROM users WHERE account_id = ?', accountId);
        if (concurrentUser) return concurrentUser;
        throw error;
      }
    },
    findOrCreateUser: async (accountId, id) => {
      const existing = await one('SELECT id, is_banned FROM users WHERE account_id = ?', accountId);
      if (existing) return existing;

      const candidate = { id, is_banned: 0 };
      try {
        await run('INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)', candidate.id, accountId, '新同学');
        return candidate;
      } catch (error) {
        if (!isUserAccountUniqueConflict(error)) throw error;
        const concurrentUser = await one('SELECT id, is_banned FROM users WHERE account_id = ?', accountId);
        if (concurrentUser) return concurrentUser;
        throw error;
      }
    },
    createSession: (hash, userId) => run(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ${nowPlusSevenDays})`, hash, userId),
    bindProfile: (name, studentNumber, userId) => run('UPDATE users SET legal_name = ?, student_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND legal_name IS NULL AND student_number IS NULL', name, studentNumber, userId),
    profile: (userId) => one('SELECT nickname, avatar_url, legal_name, student_number FROM users WHERE id = ?', userId),
    updateProfile: (nickname, avatarUrl, userId) => run('UPDATE users SET nickname = CASE WHEN ? THEN ? ELSE nickname END, avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END, updated_at = CURRENT_TIMESTAMP WHERE id = ?', nickname !== undefined ? 1 : 0, nickname ?? null, avatarUrl !== undefined ? 1 : 0, avatarUrl ?? null, userId),
    createChangeRequest: (id, userId, name, studentNumber) => run('INSERT INTO profile_change_requests (id, user_id, requested_name, requested_student_number) VALUES (?, ?, ?, ?)', id, userId, name || null, studentNumber || null),
    isAdmin: async (userId) => Boolean(await one("SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.role_key = 'admin'", userId)),
    isPrimaryAdmin: async (userId) => Boolean(await one("SELECT 1 FROM primary_admin_assignment WHERE singleton_key = 'primary' AND user_id = ?", userId)),
    listUsersForAdmin: async (query) => {
      const pattern = `%${query}%`;
      return many("SELECT u.id, u.legal_name, u.student_number, u.is_banned, u.created_at, EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.role_key = 'admin') AS is_admin, EXISTS (SELECT 1 FROM primary_admin_assignment pa WHERE pa.singleton_key = 'primary' AND pa.user_id = u.id) AS is_primary_admin FROM users u WHERE u.legal_name LIKE ? OR u.student_number LIKE ? ORDER BY u.updated_at DESC LIMIT 50", pattern, pattern);
    },
    writeAdminAudit: (id, actorUserId, action, targetType, targetId) => run('INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id) VALUES (?, ?, ?, ?, ?)', id, actorUserId, action, targetType, targetId || null),
  };
}

module.exports = { createRepository };
