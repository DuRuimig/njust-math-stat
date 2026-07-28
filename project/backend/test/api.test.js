const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const pino = require('pino');
const request = require('supertest');
const { sqliteDatabase } = require('../src/db');
const { createApp, tokenHash } = require('../src/app');
const { createWechatAuth, WechatAuthError } = require('../src/wechat-auth');
const courseLibrary = require('../../../miniprogram/data/course-library');

let db;
let app;
const courseKey = '11129201:数学分析(I)';
const teacherId = `directory:${crypto.createHash('sha256').update('test-teacher|数学系').digest('hex')}`;
const v1 = '/api/v1';
const forbiddenIdentityKeys = ['user', 'userId', 'name', 'studentNumber', 'nickname', 'avatarUrl', 'accountId'];
const teacherDirectoryKey = (teacher) => {
  const sourceKey = teacher.academyDirectoryLink || `${teacher.name}|${teacher.department || ''}`;
  return `directory:${crypto.createHash('sha256').update(sourceKey).digest('hex')}`;
};

beforeAll(() => {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'njust-api-')), 'test.sqlite');
  db = sqliteDatabase(databasePath);
  for (const migration of ['001_initial.sql', '002_teacher_feedback.sql', '003_course_comment_limit.sql', '004_admin_preparation.sql', '005_account_moderation.sql', '006_primary_admin.sql']) {
    db.exec(fs.readFileSync(path.resolve(__dirname, `../../../database/migrations/${migration}`), 'utf8'));
  }
  db.prepare('INSERT INTO courses (id, stable_key, code, normalized_name, name) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), courseKey, '11129201', '数学分析(I)', '数学分析（I）');
  db.prepare('INSERT INTO teachers (id, directory_key, name, department) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), teacherId, '测试教师', '数学系');
  app = createApp({ db, env: 'test' });
});
afterAll(() => db.close());

async function session(accountId, options = {}) {
  const response = await request(app).post(`${v1}/dev/sessions`).send({ accountId, ...options });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ expiresInSeconds: 604800, mode: 'development-test-only' });
  expect(typeof response.body.token).toBe('string');
  return response.body.token;
}
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const coursePath = (suffix) => `${v1}/courses/${encodeURIComponent(courseKey)}/${suffix}`;
const teacherPath = (suffix) => `${v1}/teachers/${encodeURIComponent(teacherId)}/${suffix}`;

function forcedSqliteUniqueConflictDatabase() {
  const state = { userLookups: 0, userInsertAttempts: 0, sessionInsertAttempts: 0 };
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
        if (sql.startsWith('INSERT INTO sessions ')) {
          return {
            run() {
              state.sessionInsertAttempts += 1;
              return { changes: 1 };
            },
          };
        }
        throw new Error(`Unexpected SQLite query: ${sql}`);
      },
    },
  };
}

function expectAnonymous(comment) {
  expect(comment).toMatchObject({ anonymous: true });
  expect(comment.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(comment.authorNickname).toEqual(expect.any(String));
  for (const key of forbiddenIdentityKeys) expect(comment).not.toHaveProperty(key);
}

describe('v1 API 契约', () => {
  it('接受云托管代理附加的 X-Forwarded-For 请求头', async () => {
    const response = await request(app)
      .post(`${v1}/auth/test-identity`)
      .set('X-Forwarded-For', '203.0.113.10')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('44 个教师目录稳定键与 seed 口径一致', () => {
    expect(courseLibrary.teachers).toHaveLength(44);
    const directoryKeys = courseLibrary.teachers.map(teacherDirectoryKey);
    expect(new Set(directoryKeys).size).toBe(44);
    expect(directoryKeys.every((key) => /^directory:[a-f0-9]{64}$/.test(key))).toBe(true);
  });

  it('开发会话仅接受账号标识，并创建未绑定的 Bearer 会话', async () => {
    expect((await request(app).get(`${v1}/profile`)).status).toBe(401);
    for (const body of [
      { accountId: 'student-a', name: '测试姓名' },
      { accountId: 'student-a', studentNumber: '12345678' },
      { accountId: 'student-a', nickname: '小明' },
    ]) {
      const response = await request(app).post(`${v1}/dev/sessions`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }

    const token = await session('student-a');
    const profile = await request(app).get(`${v1}/profile`).set(auth(token));
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual({
      userId: expect.any(String),
      bindingStatus: 'unbound',
      nickname: '新同学',
      avatarUrl: null,
      privateBinding: { name: null, studentNumber: null },
      isAdmin: false,
      isPrimaryAdmin: false,
    });
  });

  it('生产环境禁用开发测试会话', async () => {
    const productionApp = createApp({ db, env: 'production' });
    const response = await request(productionApp).post(`${v1}/dev/sessions`).send({ accountId: 'production-attempt' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('测试身份登录受显式开关保护，并只接受姓名和 12 位学号', async () => {
    const disabled = await request(app).post(`${v1}/auth/test-identity`).send({ name: '测试姓名', studentNumber: '123456789012' });
    expect(disabled.status).toBe(404);
    expect(disabled.body.error.code).toBe('NOT_FOUND');

    const testIdentityApp = createApp({ db, env: 'production', testIdentityLoginEnabled: true });
    for (const body of [
      {},
      { name: '测试姓名', studentNumber: '12345678901' },
      { name: '测试姓名', studentNumber: '1234567890123' },
      { name: '测试姓名', studentNumber: '12345678901a' },
      { name: '测试姓名', studentNumber: '123456789012', accountId: 'forged-account' },
    ]) {
      const response = await request(testIdentityApp).post(`${v1}/auth/test-identity`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('测试身份以学号稳定识别用户，拒绝姓名冲突且不泄露明文学号到账户键', async () => {
    const studentNumber = '123456789012';
    const name = '测试姓名';
    const expectedAccountId = `test-identity:${crypto.createHash('sha256').update(studentNumber).digest('hex')}`;
    const testIdentityApp = createApp({ db, env: 'production', testIdentityLoginEnabled: true });

    const first = await request(testIdentityApp).post(`${v1}/auth/test-identity`).send({ name, studentNumber });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ mode: 'test-identity', expiresInSeconds: 604800 });
    const profile = await request(testIdentityApp).get(`${v1}/profile`).set(auth(first.body.token));
    expect(profile.body).toMatchObject({ bindingStatus: 'bound', privateBinding: { name, studentNumber } });

    const second = await request(testIdentityApp).post(`${v1}/auth/test-identity`).send({ name, studentNumber });
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users WHERE account_id = ?').get(expectedAccountId).count).toBe(1);
    expect(expectedAccountId).not.toContain(studentNumber);

    const conflict = await request(testIdentityApp).post(`${v1}/auth/test-identity`).send({ name: '不同姓名', studentNumber });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('TEST_IDENTITY_MISMATCH');
    expect(db.prepare('SELECT legal_name, student_number FROM users WHERE account_id = ?').get(expectedAccountId)).toEqual({ legal_name: name, student_number: studentNumber });
  });

  it('同一测试身份的并发首次进入只创建一个用户', async () => {
    const studentNumber = '123456789013';
    const name = '并发测试';
    const expectedAccountId = `test-identity:${crypto.createHash('sha256').update(studentNumber).digest('hex')}`;
    const testIdentityApp = createApp({ db, env: 'production', testIdentityLoginEnabled: true });

    const [first, second] = await Promise.all([
      request(testIdentityApp).post(`${v1}/auth/test-identity`).send({ name, studentNumber }),
      request(testIdentityApp).post(`${v1}/auth/test-identity`).send({ name, studentNumber }),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users WHERE account_id = ?').get(expectedAccountId).count).toBe(1);
  });

  it('微信登录只接受一次性 code，服务端校验后才创建 Bearer 会话', async () => {
    const mockWechatOpenId = crypto.randomBytes(24).toString('base64url');
    const expectedAccountId = `wechat:${crypto.createHash('sha256').update(mockWechatOpenId).digest('hex')}`;
    let verifiedCodeCount = 0;
    const wechatApp = createApp({
      db,
      env: 'production',
      wechatAuth: async (code) => {
        verifiedCodeCount += 1;
        if (code === 'expired-code') {
          throw new WechatAuthError('WECHAT_CODE_INVALID', '微信登录凭据无效或已过期，请重试');
        }
        return { openid: mockWechatOpenId };
      },
    });
    const forgedIdentity = await request(wechatApp).post(`${v1}/auth/wechat`).send({ openid: 'forged-openid', code: 'valid-code' });
    expect(forgedIdentity.status).toBe(400);
    expect(forgedIdentity.body.error.code).toBe('VALIDATION_FAILED');

    const login = await request(wechatApp).post(`${v1}/auth/wechat`).send({ code: 'valid-code' });
    expect(login.status).toBe(201);
    expect(login.body).toMatchObject({ expiresInSeconds: 604800, mode: 'wechat' });
    expect(typeof login.body.token).toBe('string');
    expect(verifiedCodeCount).toBe(1);
    const storedAccount = db.prepare('SELECT account_id FROM users WHERE account_id = ?').get(expectedAccountId);
    expect(storedAccount).toEqual({ account_id: expectedAccountId });
    expect(storedAccount.account_id).not.toContain(mockWechatOpenId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users WHERE account_id = ?').get(`wechat:${mockWechatOpenId}`).count).toBe(0);
    expect(db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(login.body.token)).toBeUndefined();
    expect(db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(tokenHash(login.body.token))).toEqual({ token_hash: tokenHash(login.body.token) });

    expect((await request(wechatApp).get(`${v1}/profile`).set(auth(login.body.token))).status).toBe(200);
    const expiredCode = await request(wechatApp).post(`${v1}/auth/wechat`).send({ code: 'expired-code' });
    expect(expiredCode.status).toBe(401);
    expect(expiredCode.body.error.code).toBe('WECHAT_CODE_INVALID');
    const invalidSession = await request(wechatApp).post(coursePath('likes')).set(auth('forged-bearer-token'));
    expect(invalidSession.status).toBe(401);
    expect(invalidSession.body.error.code).toBe('SESSION_INVALID');
  });

  it('同一微信身份的并发首次登录不会返回 500，且只创建一个用户记录', async () => {
    const mockWechatOpenId = crypto.randomBytes(24).toString('base64url');
    const expectedAccountId = `wechat:${crypto.createHash('sha256').update(mockWechatOpenId).digest('hex')}`;
    let authCalls = 0;
    let releaseIdentity;
    const bothRequestsStarted = new Promise((resolve) => { releaseIdentity = resolve; });
    const concurrentWechatApp = createApp({
      db,
      env: 'production',
      wechatAuth: async () => {
        authCalls += 1;
        if (authCalls === 2) releaseIdentity();
        await bothRequestsStarted;
        return { openid: mockWechatOpenId };
      },
    });

    const [firstLogin, secondLogin] = await Promise.all([
      request(concurrentWechatApp).post(`${v1}/auth/wechat`).send({ code: 'parallel-code-one' }),
      request(concurrentWechatApp).post(`${v1}/auth/wechat`).send({ code: 'parallel-code-two' }),
    ]);

    expect(authCalls).toBe(2);
    expect([firstLogin.status, secondLogin.status]).toEqual([201, 201]);
    expect([firstLogin.status, secondLogin.status]).not.toContain(500);
    const storedAccount = db.prepare('SELECT account_id FROM users WHERE account_id = ?').get(expectedAccountId);
    expect(storedAccount).toEqual({ account_id: expectedAccountId });
    expect(storedAccount.account_id).not.toContain(mockWechatOpenId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users WHERE account_id = ?').get(expectedAccountId).count).toBe(1);
  });

  it('微信登录在强制 SQLite UNIQUE 恢复分支后返回 201 而非 500', async () => {
    const fixture = forcedSqliteUniqueConflictDatabase();
    const wechatApp = createApp({
      db: fixture.database,
      env: 'production',
      wechatAuth: async () => ({ openid: crypto.randomBytes(24).toString('base64url') }),
    });

    const response = await request(wechatApp).post(`${v1}/auth/wechat`).send({ code: 'forced-unique-code' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ mode: 'wechat', expiresInSeconds: 604800 });
    expect(fixture.state).toEqual({ userLookups: 2, userInsertAttempts: 1, sessionInsertAttempts: 1 });
  });

  it('微信身份服务未配置或拒绝 code 时不创建用户或会话', async () => {
    const unconfiguredApp = createApp({
      db,
      env: 'production',
      wechatAuth: async () => {
        throw new WechatAuthError('WECHAT_LOGIN_UNCONFIGURED', '真实微信登录尚未配置，无法完成身份认证');
      },
    });
    const beforeUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const response = await request(unconfiguredApp).post(`${v1}/auth/wechat`).send({ code: 'valid-code' });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('WECHAT_LOGIN_UNCONFIGURED');
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(beforeUsers);
  });

  it('仅微信明确拒绝的一次性 code 返回 401，密钥或上游错误不伪装为客户端失败', async () => {
    const createAuthWithWechatError = (errcode) => createWechatAuth({
      env: { WX_MINIPROGRAM_APP_ID: 'test-app-id', WX_MINIPROGRAM_APP_SECRET: 'test-app-secret' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ errcode }) }),
    });
    const invalidCodeAuth = createAuthWithWechatError(40029);
    await expect(invalidCodeAuth('test-code')).rejects.toMatchObject({ code: 'WECHAT_CODE_INVALID' });

    const reusedCodeAuth = createAuthWithWechatError(40163);
    await expect(reusedCodeAuth('test-code')).rejects.toMatchObject({ code: 'WECHAT_CODE_INVALID' });

    const unavailableAuth = createAuthWithWechatError(40125);
    await expect(unavailableAuth('test-code')).rejects.toMatchObject({ code: 'WECHAT_AUTH_UNAVAILABLE' });
  });

  it('首次身份绑定要求认证并在成功后返回当前 profile', async () => {
    const anonymous = await request(app).post(`${v1}/profile/binding`).send({ name: '测试姓名', studentNumber: '12345678' });
    expect(anonymous.status).toBe(401);

    const token = await session('student-binding');
    for (const body of [{ name: '测试姓名' }, { studentNumber: '12345678' }, { name: '测试姓名', studentNumber: '12345678', nickname: '错误字段' }]) {
      const invalid = await request(app).post(`${v1}/profile/binding`).set(auth(token)).send(body);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    }
    const bound = await request(app).post(`${v1}/profile/binding`).set(auth(token)).send({ name: '测试姓名', studentNumber: '12345678' });
    expect(bound.status).toBe(201);
    expect(bound.body).toEqual({
      userId: expect.any(String),
      bindingStatus: 'bound',
      nickname: '新同学',
      avatarUrl: null,
      privateBinding: { name: '测试姓名', studentNumber: '12345678' },
      isAdmin: false,
      isPrimaryAdmin: false,
    });

    const profile = await request(app).get(`${v1}/profile`).set(auth(token));
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual(bound.body);
  });

  it('重复身份绑定明确返回 409', async () => {
    const token = await session('student-binding-conflict');
    expect((await request(app).post(`${v1}/profile/binding`).set(auth(token)).send({ name: '测试姓名', studentNumber: '12345678' })).status).toBe(201);
    const newSessionToken = await session('student-binding-conflict');
    const repeated = await request(app).post(`${v1}/profile/binding`).set(auth(newSessionToken)).send({ name: '新姓名', studentNumber: '87654321' });
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toMatchObject({ code: 'BINDING_ALREADY_EXISTS' });
  });

  it('仅未绑定账号可首次绑定，部分绑定账号不可覆盖资料', async () => {
    const accountId = 'student-partial-binding';
    const userId = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, account_id, nickname, legal_name) VALUES (?, ?, ?, ?)')
      .run(userId, accountId, '新同学', '已有姓名');

    const token = await session(accountId);
    const response = await request(app).post(`${v1}/profile/binding`).set(auth(token)).send({ name: '尝试覆盖', studentNumber: '12345678' });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'BINDING_ALREADY_EXISTS' });
    expect(db.prepare('SELECT legal_name, student_number FROM users WHERE id = ?').get(userId)).toEqual({
      legal_name: '已有姓名',
      student_number: null,
    });
  });

  it('profile PATCH 严格拒绝姓名和学号', async () => {
    const token = await session('student-b');
    for (const body of [{ name: '新姓名' }, { studentNumber: '12345678' }, { nickname: '新昵称', name: '新姓名' }]) {
      const response = await request(app).patch(`${v1}/profile`).set(auth(token)).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('课程评论不要求点赞并实时显示当前昵称，课程点赞仍可独立切换', async () => {
    const token = await session('student-c');
    expect((await request(app).delete(coursePath('likes'))).status).toBe(401);
    const beforeLike = await request(app).post(coursePath('comments')).set(auth(token)).send({ content: '未点赞评论' });
    expect(beforeLike.status).toBe(201);
    expect(beforeLike.body.comment).toMatchObject({ content: '未点赞评论', authorNickname: '新同学' });
    expectAnonymous(beforeLike.body.comment);
    const firstLike = await request(app).post(coursePath('likes')).set(auth(token));
    expect(firstLike.status).toBe(201);
    expect(firstLike.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
    for (const body of [{ body: '错误字段' }, { content: 'a'.repeat(301) }]) {
      const response = await request(app).post(coursePath('comments')).set(auth(token)).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    const created = await request(app).post(coursePath('comments')).set(auth(token)).send({ content: 'a'.repeat(300) });
    expect(created.status).toBe(201);
    expect(created.body.comment.content).toHaveLength(300);
    expectAnonymous(created.body.comment);
    expect(() => db.prepare('INSERT INTO course_comments (id, user_id, course_id, body) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), db.prepare('SELECT id FROM users WHERE account_id = ?').get('student-c').id, db.prepare('SELECT id FROM courses WHERE stable_key = ?').get(courseKey).id, 'a'.repeat(301))).toThrow();

    const cancelled = await request(app).delete(coursePath('likes')).set(auth(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ liked: false, likeCount: 0 });
    const repeatedCancel = await request(app).delete(coursePath('likes')).set(auth(token));
    expect(repeatedCancel.status).toBe(200);
    expect(repeatedCancel.body).toEqual({ liked: false, likeCount: 0 });
    const afterCancel = await request(app).post(coursePath('comments')).set(auth(token)).send({ content: '取消后的新评论' });
    expect(afterCancel.status).toBe(201);
    expect(afterCancel.body.comment).toMatchObject({ content: '取消后的新评论', authorNickname: '新同学' });

    expect((await request(app).patch(`${v1}/profile`).set(auth(token)).send({ nickname: '课程同学' })).status).toBe(200);

    const cancelledFeedback = await request(app).get(coursePath('feedback')).set(auth(token));
    expect(cancelledFeedback.status).toBe(200);
    expect(cancelledFeedback.body).toMatchObject({ likeCount: 0, likedByMe: false });
    expect(cancelledFeedback.body.comments).toHaveLength(3);
    expect(cancelledFeedback.body.comments.every((comment) => comment.authorNickname === '课程同学')).toBe(true);
    cancelledFeedback.body.comments.forEach(expectAnonymous);

    const publicFeedback = await request(app).get(coursePath('feedback'));
    expect(publicFeedback.status).toBe(200);
    expect(publicFeedback.body.comments).toHaveLength(3);
    expect(publicFeedback.body.comments.every((comment) => !comment.canDelete && !comment.canModerate)).toBe(true);

    const reliked = await request(app).post(coursePath('likes')).set(auth(token));
    expect(reliked.status).toBe(201);
    expect(reliked.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
    const relikedFeedback = await request(app).get(coursePath('feedback')).set(auth(token));
    expect(relikedFeedback.body).toMatchObject({ likeCount: 1, likedByMe: true });
  });

  it('课程 key 被云网关二次编码时仍可读取并点赞', async () => {
    const token = await session('student-double-encoded-course');
    const doubleEncodedPath = `${v1}/courses/${encodeURIComponent(encodeURIComponent(courseKey))}`;

    const feedback = await request(app).get(`${doubleEncodedPath}/feedback`).set(auth(token));
    expect(feedback.status).toBe(200);
    expect(feedback.body).toMatchObject({ likedByMe: false });

    const liked = await request(app).post(`${doubleEncodedPath}/likes`).set(auth(token));
    expect(liked.status).toBe(201);
    expect(liked.body).toMatchObject({ liked: true, alreadyLiked: false });
  });

  it('管理员可以更正身份并删除任意评论，普通用户不会获得越权能力', async () => {
    const adminStudentNumber = '900000000001';
    const adminName = '管理员测试';
    const adminAccountId = `test-identity:${crypto.createHash('sha256').update(adminStudentNumber).digest('hex')}`;
    const adminApp = createApp({ db, env: 'production', testIdentityLoginEnabled: true, initialAdminAccountId: adminAccountId });
    const adminLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: adminName, studentNumber: adminStudentNumber });
    expect(adminLogin.status).toBe(201);
    const adminToken = adminLogin.body.token;
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(adminToken))).body).toMatchObject({ isAdmin: true, isPrimaryAdmin: true });

    const memberNumber = '900000000002';
    const memberLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: '普通测试', studentNumber: memberNumber });
    const memberToken = memberLogin.body.token;
    const memberLike = await request(adminApp).post(coursePath('likes')).set(auth(memberToken));
    expect(memberLike.status).toBe(201);
    const created = await request(adminApp).post(coursePath('comments')).set(auth(memberToken)).send({ content: '需要管理的评论' });
    expect(created.status).toBe(201);
    const commentId = created.body.comment.id;

    const forbiddenDelete = await request(app).delete(`${coursePath('comments')}/${commentId}`).set(auth(await session('other-student')));
    expect(forbiddenDelete.status).toBe(403);
    expect(forbiddenDelete.body.error.code).toBe('COMMENT_DELETE_FORBIDDEN');
    expect((await request(app).get(`${v1}/admin/users?q=${encodeURIComponent('普通测试')}`).set(auth(await session('other-student')))).status).toBe(403);

    const search = await request(adminApp).get(`${v1}/admin/users?q=${encodeURIComponent('普通测试')}`).set(auth(adminToken));
    expect(search.status).toBe(200);
    const member = search.body.items.find((item) => item.studentNumber === memberNumber);
    expect(member).toMatchObject({ name: '普通测试', isAdmin: false, isPrimaryAdmin: false });
    expect(member).not.toHaveProperty('accountId');
    const updatedNumber = '900000000003';
    db.exec("CREATE TRIGGER fail_identity_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action = 'update_identity' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END");
    const failedIdentityUpdate = await request(adminApp).patch(`${v1}/admin/users/${member.id}/identity`).set(auth(adminToken)).send({ name: '不应保存', studentNumber: updatedNumber });
    expect(failedIdentityUpdate.status).toBe(500);
    expect(db.prepare('SELECT legal_name, student_number FROM users WHERE id = ?').get(member.id)).toEqual({ legal_name: '普通测试', student_number: memberNumber });
    db.exec('DROP TRIGGER fail_identity_audit');
    const update = await request(adminApp).patch(`${v1}/admin/users/${member.id}/identity`).set(auth(adminToken)).send({ name: '已更正测试', studentNumber: updatedNumber });
    expect(update.status).toBe(200);
    expect(update.body.user).toMatchObject({ id: member.id, name: '已更正测试', studentNumber: updatedNumber });
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(memberToken))).status).toBe(401);
    const correctedLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: '已更正测试', studentNumber: updatedNumber });
    expect(correctedLogin.status).toBe(201);

    const banned = await request(adminApp).patch(`${v1}/admin/users/${member.id}/account-status`).set(auth(adminToken)).send({ banned: true });
    expect(banned.status).toBe(200);
    expect(banned.body.user).toEqual({ id: member.id, isBanned: true });
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(correctedLogin.body.token))).status).toBe(401);
    const blockedLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: '已更正测试', studentNumber: updatedNumber });
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error.code).toBe('ACCOUNT_BANNED');
    expect((await request(adminApp).patch(`${v1}/admin/users/${member.id}/account-status`).set(auth(adminToken)).send({ banned: false })).status).toBe(200);
    const restoredLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: '已更正测试', studentNumber: updatedNumber });
    expect(restoredLogin.status).toBe(201);
    const grantAdmin = await request(adminApp).patch(`${v1}/admin/users/${member.id}/admin-role`).set(auth(adminToken)).send({ isAdmin: true });
    expect(grantAdmin.status).toBe(200);
    expect(grantAdmin.body.user).toEqual({ id: member.id, isAdmin: true });
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(restoredLogin.body.token))).body).toMatchObject({ userId: member.id, isAdmin: true, isPrimaryAdmin: false });
    expect((await request(app).patch(`${v1}/admin/users/${member.id}/admin-role`).set(auth(await session('other-student'))).send({ isAdmin: true })).status).toBe(403);
    const adminUserId = db.prepare('SELECT id FROM users WHERE account_id = ?').get(adminAccountId).id;
    const regularAdminCannotManageRoles = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/admin-role`).set(auth(restoredLogin.body.token)).send({ isAdmin: true });
    expect(regularAdminCannotManageRoles.status).toBe(403);
    expect(regularAdminCannotManageRoles.body.error.code).toBe('PRIMARY_ADMIN_REQUIRED');
    const regularAdminCannotBanPrimary = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/account-status`).set(auth(restoredLogin.body.token)).send({ banned: true });
    expect(regularAdminCannotBanPrimary.status).toBe(403);
    expect(regularAdminCannotBanPrimary.body.error.code).toBe('ADMIN_TARGET_PROTECTED');
    const regularAdminCannotEditPrimary = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/identity`).set(auth(restoredLogin.body.token)).send({ name: adminName, studentNumber: adminStudentNumber });
    expect(regularAdminCannotEditPrimary.status).toBe(403);
    expect(regularAdminCannotEditPrimary.body.error.code).toBe('ADMIN_TARGET_PROTECTED');
    const managedNumber = '900000000004';
    const managedLogin = await request(adminApp).post(`${v1}/auth/test-identity`).send({ name: '待管理用户', studentNumber: managedNumber });
    expect(managedLogin.status).toBe(201);
    expect((await request(adminApp).post(coursePath('likes')).set(auth(managedLogin.body.token))).status).toBe(201);
    const managedComment = await request(adminApp).post(coursePath('comments')).set(auth(managedLogin.body.token)).send({ content: '普通管理员处理的评论' });
    const managedSearch = await request(adminApp).get(`${v1}/admin/users?q=${managedNumber}`).set(auth(restoredLogin.body.token));
    expect(managedSearch.status).toBe(200);
    const managedUser = managedSearch.body.items.find((item) => item.studentNumber === managedNumber);
    expect((await request(adminApp).patch(`${v1}/admin/users/${managedUser.id}/account-status`).set(auth(restoredLogin.body.token)).send({ banned: true })).status).toBe(200);
    expect((await request(adminApp).patch(`${v1}/admin/users/${managedUser.id}/account-status`).set(auth(restoredLogin.body.token)).send({ banned: false })).status).toBe(200);
    expect((await request(adminApp).delete(`${coursePath('comments')}/${managedComment.body.comment.id}`).set(auth(restoredLogin.body.token))).status).toBe(204);
    const revokeAdmin = await request(adminApp).patch(`${v1}/admin/users/${member.id}/admin-role`).set(auth(adminToken)).send({ isAdmin: false });
    expect(revokeAdmin.status).toBe(200);
    expect(revokeAdmin.body.user).toEqual({ id: member.id, isAdmin: false });
    const selfBan = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/account-status`).set(auth(adminToken)).send({ banned: true });
    expect(selfBan.status).toBe(400);
    expect(selfBan.body.error.code).toBe('SELF_BAN_FORBIDDEN');
    const selfRoleChange = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/admin-role`).set(auth(adminToken)).send({ isAdmin: false });
    expect(selfRoleChange.status).toBe(400);
    expect(selfRoleChange.body.error.code).toBe('SELF_ADMIN_ROLE_CHANGE_FORBIDDEN');
    db.exec("CREATE TRIGGER fail_primary_transfer_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.action = 'transfer_primary_admin' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END");
    const failedTransfer = await request(adminApp).patch(`${v1}/admin/users/${member.id}/primary-admin`).set(auth(adminToken));
    expect(failedTransfer.status).toBe(500);
    expect(db.prepare("SELECT user_id FROM primary_admin_assignment WHERE singleton_key = 'primary'").get()).toEqual({ user_id: adminUserId });
    expect(db.prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ?').get(member.id, 'b2ab8a66-7151-4f49-9bf0-e4beeb3f5ea3')).toBeUndefined();
    db.exec('DROP TRIGGER fail_primary_transfer_audit');
    const transferPrimaryAdmin = await request(adminApp).patch(`${v1}/admin/users/${member.id}/primary-admin`).set(auth(adminToken));
    expect(transferPrimaryAdmin.status).toBe(200);
    expect(transferPrimaryAdmin.body.user).toEqual({ id: member.id, isAdmin: true, isPrimaryAdmin: true });
    expect(db.prepare("SELECT singleton_key, user_id FROM primary_admin_assignment").all()).toEqual([{ singleton_key: 'primary', user_id: member.id }]);
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(restoredLogin.body.token))).body).toMatchObject({ isAdmin: true, isPrimaryAdmin: true });
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(adminToken))).body).toMatchObject({ isAdmin: true, isPrimaryAdmin: false });
    const formerPrimaryCannotManageRoles = await request(adminApp).patch(`${v1}/admin/users/${member.id}/admin-role`).set(auth(adminToken)).send({ isAdmin: false });
    expect(formerPrimaryCannotManageRoles.status).toBe(403);
    expect(formerPrimaryCannotManageRoles.body.error.code).toBe('PRIMARY_ADMIN_REQUIRED');
    const revokeFormerPrimary = await request(adminApp).patch(`${v1}/admin/users/${adminUserId}/admin-role`).set(auth(restoredLogin.body.token)).send({ isAdmin: false });
    expect(revokeFormerPrimary.status).toBe(200);
    expect((await request(adminApp).get(`${v1}/profile`).set(auth(adminToken))).body).toMatchObject({ isAdmin: false, isPrimaryAdmin: false });

    const deleted = await request(adminApp).delete(`${coursePath('comments')}/${commentId}`).set(auth(restoredLogin.body.token));
    expect(deleted.status).toBe(204);
    expect((await request(adminApp).get(coursePath('feedback')).set(auth(adminToken))).body.comments.some((item) => item.id === commentId)).toBe(false);
    expect(db.prepare("SELECT action, target_type, target_id FROM admin_audit_logs WHERE action = 'delete_comment' AND target_id = ?").get(commentId)).toEqual({ action: 'delete_comment', target_type: 'course_comment', target_id: commentId });
    expect(db.prepare("SELECT action FROM admin_audit_logs WHERE action = 'grant_admin_role' AND target_id = ?").get(member.id)).toEqual({ action: 'grant_admin_role' });
    expect(db.prepare("SELECT action FROM admin_audit_logs WHERE action = 'transfer_primary_admin' AND target_id = ?").get(member.id)).toEqual({ action: 'transfer_primary_admin' });
  });

  it('接受真机传来的全角课程括号', async () => {
    const token = await session('student-full-width-course-key');
    const deviceCourseKey = '11129201:数学分析（I）';
    const devicePath = `${v1}/courses/${encodeURIComponent(deviceCourseKey)}`;

    const feedback = await request(app).get(`${devicePath}/feedback`).set(auth(token));
    expect(feedback.status).toBe(200);

    const liked = await request(app).post(`${devicePath}/likes`).set(auth(token));
    expect(liked.status).toBe(201);
    expect(liked.body).toMatchObject({ liked: true, alreadyLiked: false });
  });

  it('找不到课程时记录收到的课程 key，便于排查云端路由差异', async () => {
    const warnings = [];
    const logger = pino({
      hooks: {
        logMethod(args, method, level) {
          if (level === 40) warnings.push({ payload: args[0], message: args[1] });
          return method.apply(this, args);
        },
      },
    }, { write() {} });
    const diagnosticApp = createApp({ db, env: 'test', logger });

    const response = await request(diagnosticApp).post(`${v1}/courses/missing-course/likes`).set(auth(await session('student-missing-course')));

    expect(response.status).toBe(404);
    expect(warnings).toContainEqual({
      payload: { targetType: 'course', method: 'POST', receivedKey: 'missing-course', decodedKey: 'missing-course' },
      message: '[course-target-not-found]',
    });
  });

  it('教师支持点赞、幂等取消、重新点赞，并同步摘要 likedByMe', async () => {
    const token = await session('student-d');
    const summaryPath = `${v1}/teachers/feedback-summary?ids=${encodeURIComponent(teacherId)}`;
    const anonymous = await request(app).get(summaryPath);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body).toEqual({ items: [{ teacherId, likeCount: 0 }] });
    for (const key of forbiddenIdentityKeys.concat(['comments', 'department', 'directoryLink', 'advisorQualifications'])) {
      expect(anonymous.body.items[0]).not.toHaveProperty(key);
    }
    expect((await request(app).get(`${v1}/teachers/feedback-summary`)).body).toEqual({ items: [{ teacherId, likeCount: 0 }] });

    const beforeLikeComment = await request(app).post(teacherPath('comments')).set(auth(token)).send({ content: '教师未点赞评论' });
    expect(beforeLikeComment.status).toBe(403);
    expect(beforeLikeComment.body.error.code).toBe('LIKE_REQUIRED');

    const firstLike = await request(app).post(teacherPath('likes')).set(auth(token));
    expect(firstLike.status).toBe(201);
    expect(firstLike.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
    const teacherComment = await request(app).post(teacherPath('comments')).set(auth(token)).send({ content: '教师评价' });
    expect(teacherComment.status).toBe(201);
    expect(teacherComment.body.comment).toMatchObject({ content: '教师评价', authorNickname: '新同学' });
    expectAnonymous(teacherComment.body.comment);
    expect((await request(app).get(summaryPath).set(auth(token))).body).toEqual({ items: [{ teacherId, likeCount: 1, likedByMe: true }] });

    expect((await request(app).delete(teacherPath('likes'))).status).toBe(401);
    const cancelled = await request(app).delete(teacherPath('likes')).set(auth(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ liked: false, likeCount: 0 });
    const repeatedCancel = await request(app).delete(teacherPath('likes')).set(auth(token));
    expect(repeatedCancel.status).toBe(200);
    expect(repeatedCancel.body).toEqual({ liked: false, likeCount: 0 });
    expect((await request(app).get(summaryPath).set(auth(token))).body).toEqual({ items: [{ teacherId, likeCount: 0, likedByMe: false }] });

    const reliked = await request(app).post(teacherPath('likes')).set(auth(token));
    expect(reliked.status).toBe(201);
    expect(reliked.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
    expect((await request(app).get(summaryPath).set(auth(token))).body).toEqual({ items: [{ teacherId, likeCount: 1, likedByMe: true }] });
  });

  it('教师批量点赞摘要严格校验目录标识', async () => {
    for (const query of ['?ids=invalid', '?ids=', `?ids=${encodeURIComponent(`${teacherId},${teacherId}`)}`, `?ids=${Array.from({ length: 101 }, () => teacherId).join(',')}`]) {
      const response = await request(app).get(`${v1}/teachers/feedback-summary${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
  });
});
