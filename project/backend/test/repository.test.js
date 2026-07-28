const { createRepository } = require('../src/repository');

function sqliteUniqueConflictDatabase() {
  const state = { userLookups: 0, userInsertAttempts: 0 };
  return {
    state,
    database: {
      kind: 'sqlite',
      prepare(sql) {
        if (sql === 'SELECT id, is_banned FROM users WHERE account_id = ?') {
          return {
            get() {
              state.userLookups += 1;
              return state.userLookups === 1 ? undefined : { id: 'existing-user', is_banned: 0 };
            },
          };
        }
        if (sql === 'INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)') {
          return {
            run() {
              state.userInsertAttempts += 1;
              const error = new Error('unique account conflict');
              error.code = 'SQLITE_CONSTRAINT_UNIQUE';
              throw error;
            },
          };
        }
        throw new Error(`Unexpected SQLite query: ${sql}`);
      },
    },
  };
}

function mysqlDuplicateEntryDatabase() {
  const state = { userLookups: 0, userInsertAttempts: 0 };
  return {
    state,
    database: {
      kind: 'mysql',
      async execute(sql) {
        if (sql === 'SELECT id, is_banned FROM users WHERE account_id = ?') {
          state.userLookups += 1;
          return [state.userLookups === 1 ? [] : [{ id: 'existing-user', is_banned: 0 }]];
        }
        if (sql === 'INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)') {
          state.userInsertAttempts += 1;
          const error = new Error('duplicate account entry');
          error.code = 'ER_DUP_ENTRY';
          throw error;
        }
        throw new Error(`Unexpected MySQL query: ${sql}`);
      },
    },
  };
}

describe('用户查找或创建的唯一冲突恢复', () => {
  it('SQLite UNIQUE 冲突后重新查询既有用户', async () => {
    const fixture = sqliteUniqueConflictDatabase();
    const repository = createRepository(fixture.database);

    await expect(repository.findOrCreateUser('wechat:hashed-key', 'candidate-user')).resolves.toEqual({ id: 'existing-user', is_banned: 0 });

    expect(fixture.state.userLookups).toBe(2);
    expect(fixture.state.userInsertAttempts).toBe(1);
  });

  it('MySQL ER_DUP_ENTRY 冲突后重新查询既有用户', async () => {
    const fixture = mysqlDuplicateEntryDatabase();
    const repository = createRepository(fixture.database);

    await expect(repository.findOrCreateUser('wechat:hashed-key', 'candidate-user')).resolves.toEqual({ id: 'existing-user', is_banned: 0 });

    expect(fixture.state.userLookups).toBe(2);
    expect(fixture.state.userInsertAttempts).toBe(1);
  });
});

describe('MySQL 管理员事务', () => {
  function mysqlTransactionFixture({ failAudit = false } = {}) {
    const actorUserId = '11111111-1111-4111-8111-111111111111';
    const targetUserId = '22222222-2222-4222-8222-222222222222';
    const state = { began: 0, committed: 0, rolledBack: 0, released: 0, sql: [] };
    const connection = {
      async beginTransaction() { state.began += 1; },
      async commit() { state.committed += 1; },
      async rollback() { state.rolledBack += 1; },
      release() { state.released += 1; },
      async execute(sql) {
        state.sql.push(sql);
        if (sql.includes("FROM primary_admin_assignment") && sql.includes('FOR UPDATE')) return [[{ user_id: actorUserId }]];
        if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return [[{ id: targetUserId, is_banned: 0 }]];
        if (sql.startsWith('INSERT INTO admin_audit_logs') && failAudit) throw new Error('forced audit failure');
        return [{ affectedRows: 1 }];
      },
    };
    return {
      actorUserId,
      targetUserId,
      state,
      database: {
        kind: 'mysql',
        async execute() { return [[]]; },
        async getConnection() { return connection; },
      },
    };
  }

  it('主管理员移交锁定单例与目标用户并提交', async () => {
    const fixture = mysqlTransactionFixture();
    const repository = createRepository(fixture.database);

    await expect(repository.transferPrimaryAdmin(fixture.actorUserId, fixture.targetUserId, 'audit-id')).resolves.toEqual({ updated: true });

    expect(fixture.state).toMatchObject({ began: 1, committed: 1, rolledBack: 0, released: 1 });
    expect(fixture.state.sql.filter((sql) => sql.includes('FOR UPDATE'))).toHaveLength(2);
    expect(fixture.state.sql.some((sql) => sql.startsWith('INSERT INTO admin_audit_logs'))).toBe(true);
  });

  it('审计写入失败时回滚 MySQL 权限事务', async () => {
    const fixture = mysqlTransactionFixture({ failAudit: true });
    const repository = createRepository(fixture.database);

    await expect(repository.transferPrimaryAdmin(fixture.actorUserId, fixture.targetUserId, 'audit-id')).rejects.toThrow('forced audit failure');

    expect(fixture.state).toMatchObject({ began: 1, committed: 0, rolledBack: 1, released: 1 });
  });
});
