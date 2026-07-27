const { createRepository } = require('../src/repository');

function sqliteUniqueConflictDatabase() {
  const state = { userLookups: 0, userInsertAttempts: 0 };
  return {
    state,
    database: {
      kind: 'sqlite',
      prepare(sql) {
        if (sql === 'SELECT id FROM users WHERE account_id = ?') {
          return {
            get() {
              state.userLookups += 1;
              return state.userLookups === 1 ? undefined : { id: 'existing-user' };
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
        if (sql === 'SELECT id FROM users WHERE account_id = ?') {
          state.userLookups += 1;
          return [state.userLookups === 1 ? [] : [{ id: 'existing-user' }]];
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

    await expect(repository.findOrCreateUser('wechat:hashed-key', 'candidate-user')).resolves.toEqual({ id: 'existing-user' });

    expect(fixture.state.userLookups).toBe(2);
    expect(fixture.state.userInsertAttempts).toBe(1);
  });

  it('MySQL ER_DUP_ENTRY 冲突后重新查询既有用户', async () => {
    const fixture = mysqlDuplicateEntryDatabase();
    const repository = createRepository(fixture.database);

    await expect(repository.findOrCreateUser('wechat:hashed-key', 'candidate-user')).resolves.toEqual({ id: 'existing-user' });

    expect(fixture.state.userLookups).toBe(2);
    expect(fixture.state.userInsertAttempts).toBe(1);
  });
});
