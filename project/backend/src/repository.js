function createRepository(db) {
  if (db.kind === 'mysql') return createMysqlRepository(db);
  return createSqliteRepository(db);
}

function createSqliteRepository(db) {
  const one = (sql, ...params) => Promise.resolve(db.prepare(sql).get(...params));
  const many = (sql, ...params) => Promise.resolve(db.prepare(sql).all(...params));
  const run = (sql, ...params) => Promise.resolve(db.prepare(sql).run(...params));
  return createRepositoryOperations({ one, many, run, nowPlusSevenDays: "datetime('now', '+7 days')", insertIgnore: 'ON CONFLICT(user_id, TARGET_ID) DO NOTHING' });
}

function createMysqlRepository(db) {
  const one = async (sql, ...params) => (await db.execute(sql, params))[0][0];
  const many = async (sql, ...params) => (await db.execute(sql, params))[0];
  const run = async (sql, ...params) => {
    const [result] = await db.execute(sql, params);
    return { changes: result.affectedRows };
  };
  return createRepositoryOperations({ one, many, run, nowPlusSevenDays: 'DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 7 DAY)', insertIgnore: 'ON DUPLICATE KEY UPDATE user_id = user_id' });
}

function createRepositoryOperations({ one, many, run, nowPlusSevenDays, insertIgnore }) {
  const targetSql = (type) => ({ table: `${type}s`, key: type === 'course' ? 'stable_key' : 'directory_key', column: `${type}_id` });
  return {
    findSession: (hash) => one(`SELECT u.id, u.account_id, u.nickname, u.avatar_url, u.legal_name, u.student_number FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`, hash),
    findTarget: (type, key) => {
      const target = targetSql(type);
      return one(`SELECT id, ${target.key} AS target_key FROM ${target.table} WHERE ${target.key} = ?`, key);
    },
    feedback: async (type, targetId, userId) => {
      const target = targetSql(type);
      const likeCount = Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes WHERE ${target.column} = ?`, targetId)).count);
      const comments = await many(`SELECT body, created_at FROM ${type}_comments WHERE ${target.column} = ? ORDER BY created_at DESC`, targetId);
      const liked = userId ? Boolean(await one(`SELECT 1 FROM ${type}_likes WHERE user_id = ? AND ${target.column} = ?`, userId, targetId)) : false;
      return { likeCount, liked, comments };
    },
    like: async (type, userId, targetId) => {
      const target = targetSql(type);
      const result = await run(`INSERT INTO ${type}_likes (user_id, ${target.column}) VALUES (?, ?) ${insertIgnore.replace('TARGET_ID', target.column)}`, userId, targetId);
      const likeCount = Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes WHERE ${target.column} = ?`, targetId)).count);
      return { created: Boolean(result.changes), likeCount };
    },
    unlike: async (type, userId, targetId) => {
      const target = targetSql(type);
      await run(`DELETE FROM ${type}_likes WHERE user_id = ? AND ${target.column} = ?`, userId, targetId);
      return Number((await one(`SELECT COUNT(*) AS count FROM ${type}_likes WHERE ${target.column} = ?`, targetId)).count);
    },
    canComment: (type, userId, targetId) => one(`SELECT 1 FROM ${type}_likes WHERE user_id = ? AND ${type}_id = ?`, userId, targetId),
    createComment: async (type, id, userId, targetId, body) => {
      await run(`INSERT INTO ${type}_comments (id, user_id, ${type}_id, body) VALUES (?, ?, ?, ?)`, id, userId, targetId, body);
      return one(`SELECT body, created_at FROM ${type}_comments WHERE id = ?`, id);
    },
    teacherSummary: async (keys, userId) => {
      if (!keys.length) return [];
      const placeholders = keys.map(() => '?').join(', ');
      const rows = await many(`SELECT t.directory_key AS teacherId, COUNT(l.user_id) AS likeCount FROM teachers t LEFT JOIN teacher_likes l ON l.teacher_id = t.id WHERE t.directory_key IN (${placeholders}) GROUP BY t.id, t.directory_key ORDER BY t.directory_key`, ...keys);
      const liked = userId ? new Set((await many(`SELECT t.directory_key FROM teachers t JOIN teacher_likes l ON l.teacher_id = t.id WHERE l.user_id = ? AND t.directory_key IN (${placeholders})`, userId, ...keys)).map((row) => row.directory_key)) : null;
      return rows.map((row) => ({ teacherId: row.teacherId, likeCount: Number(row.likeCount), ...(liked ? { likedByMe: liked.has(row.teacherId) } : {}) }));
    },
    allTeacherKeys: () => many('SELECT directory_key FROM teachers ORDER BY directory_key'),
    findUserByAccount: (accountId) => one('SELECT id FROM users WHERE account_id = ?', accountId),
    createUser: (id, accountId) => run('INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)', id, accountId, '新同学'),
    createSession: (hash, userId) => run(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ${nowPlusSevenDays})`, hash, userId),
    bindProfile: (name, studentNumber, userId) => run('UPDATE users SET legal_name = ?, student_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND legal_name IS NULL AND student_number IS NULL', name, studentNumber, userId),
    profile: (userId) => one('SELECT nickname, avatar_url, legal_name, student_number FROM users WHERE id = ?', userId),
    updateProfile: (nickname, avatarUrl, userId) => run('UPDATE users SET nickname = CASE WHEN ? THEN ? ELSE nickname END, avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END, updated_at = CURRENT_TIMESTAMP WHERE id = ?', nickname !== undefined ? 1 : 0, nickname ?? null, avatarUrl !== undefined ? 1 : 0, avatarUrl ?? null, userId),
    createChangeRequest: (id, userId, name, studentNumber) => run('INSERT INTO profile_change_requests (id, user_id, requested_name, requested_student_number) VALUES (?, ?, ?, ?)', id, userId, name || null, studentNumber || null),
  };
}

module.exports = { createRepository };
