const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const courseLibrary = require('../../../miniprogram/data/course-library');

let db;
let app;
const courseKey = '11129201:数学分析(I)';
const teacherId = `directory:${crypto.createHash('sha256').update('test-teacher|数学系').digest('hex')}`;
const v1 = '/api/v1';
const forbiddenIdentityKeys = ['user', 'userId', 'id', 'name', 'studentNumber', 'nickname', 'avatarUrl', 'accountId'];
const teacherDirectoryKey = (teacher) => {
  const sourceKey = teacher.academyDirectoryLink || `${teacher.name}|${teacher.department || ''}`;
  return `directory:${crypto.createHash('sha256').update(sourceKey).digest('hex')}`;
};

beforeAll(() => {
  const databasePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'njust-api-')), 'test.sqlite');
  db = openDatabase(databasePath);
  for (const migration of ['001_initial.sql', '002_teacher_feedback.sql']) {
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

function expectAnonymous(comment) {
  expect(comment).toMatchObject({ anonymous: true });
  for (const key of forbiddenIdentityKeys) expect(comment).not.toHaveProperty(key);
}

describe('v1 API 契约', () => {
  it('43 个教师目录稳定键与 seed 口径一致', () => {
    expect(courseLibrary.teachers).toHaveLength(43);
    const directoryKeys = courseLibrary.teachers.map(teacherDirectoryKey);
    expect(new Set(directoryKeys).size).toBe(43);
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
      bindingStatus: 'unbound',
      nickname: '新同学',
      avatarUrl: null,
      privateBinding: { name: null, studentNumber: null },
    });
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
      bindingStatus: 'bound',
      nickname: '新同学',
      avatarUrl: null,
      privateBinding: { name: '测试姓名', studentNumber: '12345678' },
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

  it('课程支持点赞、幂等取消、重新点赞，取消后保留旧评论并拒绝新评论', async () => {
    const token = await session('student-c');
    expect((await request(app).delete(coursePath('likes'))).status).toBe(401);
    expect((await request(app).post(coursePath('comments')).set(auth(token)).send({ content: '未点赞评论' })).status).toBe(403);
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

    const cancelled = await request(app).delete(coursePath('likes')).set(auth(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ liked: false, likeCount: 0 });
    const repeatedCancel = await request(app).delete(coursePath('likes')).set(auth(token));
    expect(repeatedCancel.status).toBe(200);
    expect(repeatedCancel.body).toEqual({ liked: false, likeCount: 0 });
    const rejectedComment = await request(app).post(coursePath('comments')).set(auth(token)).send({ content: '取消后的新评论' });
    expect(rejectedComment.status).toBe(403);
    expect(rejectedComment.body.error.code).toBe('LIKE_REQUIRED');

    const cancelledFeedback = await request(app).get(coursePath('feedback')).set(auth(token));
    expect(cancelledFeedback.status).toBe(200);
    expect(cancelledFeedback.body).toMatchObject({ likeCount: 0, likedByMe: false });
    expect(cancelledFeedback.body.comments).toHaveLength(1);
    expect(cancelledFeedback.body.comments[0].content).toHaveLength(300);
    expectAnonymous(cancelledFeedback.body.comments[0]);

    const reliked = await request(app).post(coursePath('likes')).set(auth(token));
    expect(reliked.status).toBe(201);
    expect(reliked.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
    const relikedFeedback = await request(app).get(coursePath('feedback')).set(auth(token));
    expect(relikedFeedback.body).toMatchObject({ likeCount: 1, likedByMe: true });
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

    const firstLike = await request(app).post(teacherPath('likes')).set(auth(token));
    expect(firstLike.status).toBe(201);
    expect(firstLike.body).toMatchObject({ liked: true, alreadyLiked: false, likeCount: 1 });
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
