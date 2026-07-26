const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { z } = require('zod');
const { openDatabase } = require('./db');

const sessionSchema = z.object({
  accountId: z.string().trim().min(3).max(80),
}).strict();
const bindingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  studentNumber: z.string().trim().min(4).max(32),
}).strict();
const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(24).optional(),
  avatarUrl: z.string().url().max(512).nullable().optional(),
}).strict();
const changeRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  studentNumber: z.string().trim().min(4).max(32).optional(),
}).strict().refine((data) => data.name || data.studentNumber, '至少提交一个修改字段');
const commentSchema = z.object({ content: z.string().trim().min(1).max(300) }).strict();
const teacherSummaryQuerySchema = z.object({
  ids: z.string().max(6600).optional(),
}).strict();
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function bindingStatus(user) {
  if (user.legal_name && user.student_number) return 'bound';
  if (user.legal_name || user.student_number) return 'partial';
  return 'unbound';
}

function createApp({ db = openDatabase(), env = process.env.NODE_ENV || 'development', logger = pino({ enabled: process.env.NODE_ENV !== 'test' }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env === 'production' ? false : true }));
  app.use(express.json({ limit: '16kb' }));
  // Do not serialize request headers or bodies: they may contain tokens or private content.
  app.use(pinoHttp({ logger, serializers: { req: () => undefined, res: () => undefined } }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => apiError(res, 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试') }));

  function findSession(token) {
    return db.prepare(`SELECT u.id, u.account_id, u.nickname, u.avatar_url, u.legal_name, u.student_number
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`).get(tokenHash(token));
  }
  function optionalUser(req, res, next) {
    const authorization = req.get('authorization');
    if (!authorization) return next();
    if (!authorization.startsWith('Bearer ')) return apiError(res, 401, 'AUTH_REQUIRED', '需要有效会话');
    const user = findSession(authorization.slice(7));
    if (!user) return apiError(res, 401, 'SESSION_INVALID', '会话无效或已过期');
    req.user = user;
    next();
  }
  function requireUser(req, res, next) {
    optionalUser(req, res, () => req.user ? next() : apiError(res, 401, 'AUTH_REQUIRED', '需要有效会话'));
  }
  function entityByKey(table, param, label) {
    return (req, res, next) => {
      const entity = db.prepare(`SELECT id, ${param === 'courseKey' ? 'stable_key' : 'directory_key'} AS target_key FROM ${table} WHERE ${param === 'courseKey' ? 'stable_key' : 'directory_key'} = ?`).get(req.params[param]);
      if (!entity) return apiError(res, 404, 'TARGET_NOT_FOUND', `${label}不存在`);
      req.target = entity;
      next();
    };
  }
  function feedback(targetType) {
    return (req, res) => {
      const likes = db.prepare(`SELECT COUNT(*) AS count FROM ${targetType}_likes WHERE ${targetType}_id = ?`).get(req.target.id).count;
      const comments = db.prepare(`SELECT body, created_at FROM ${targetType}_comments WHERE ${targetType}_id = ? ORDER BY created_at DESC`).all(req.target.id)
        .map((item) => ({ content: item.body, createdAt: item.created_at, anonymous: true }));
      const likedByMe = req.user ? Boolean(db.prepare(`SELECT 1 FROM ${targetType}_likes WHERE user_id = ? AND ${targetType}_id = ?`).get(req.user.id, req.target.id)) : false;
      res.json({ likeCount: likes, likedByMe, comments });
    };
  }
  function like(targetType) {
    const targetColumn = `${targetType}_id`;
    return (req, res, next) => {
      const result = db.prepare(`INSERT INTO ${targetType}_likes (user_id, ${targetColumn}) VALUES (?, ?) ON CONFLICT(user_id, ${targetColumn}) DO NOTHING`).run(req.user.id, req.target.id);
      const likeCount = db.prepare(`SELECT COUNT(*) AS count FROM ${targetType}_likes WHERE ${targetColumn} = ?`).get(req.target.id).count;
      res.status(result.changes ? 201 : 200).json({ liked: true, alreadyLiked: !result.changes, likeCount });
    };
  }
  function unlike(targetType) {
    const targetColumn = `${targetType}_id`;
    return (req, res) => {
      db.prepare(`DELETE FROM ${targetType}_likes WHERE user_id = ? AND ${targetColumn} = ?`).run(req.user.id, req.target.id);
      const likeCount = db.prepare(`SELECT COUNT(*) AS count FROM ${targetType}_likes WHERE ${targetColumn} = ?`).get(req.target.id).count;
      res.json({ liked: false, likeCount });
    };
  }
  function comment(targetType) {
    const targetColumn = `${targetType}_id`;
    return (req, res) => {
      const parsed = commentSchema.safeParse(req.body);
      if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '评论需为 1 至 300 个字符');
      const liked = db.prepare(`SELECT 1 FROM ${targetType}_likes WHERE user_id = ? AND ${targetColumn} = ?`).get(req.user.id, req.target.id);
      if (!liked) return apiError(res, 403, 'LIKE_REQUIRED', '点赞后才能匿名评论');
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO ${targetType}_comments (id, user_id, ${targetColumn}, body) VALUES (?, ?, ?, ?)`).run(id, req.user.id, req.target.id, parsed.data.content);
      const created = db.prepare(`SELECT body, created_at FROM ${targetType}_comments WHERE id = ?`).get(id);
      res.status(201).json({ comment: { content: created.body, createdAt: created.created_at, anonymous: true } });
    };
  }
  function teacherFeedbackSummary(req, res) {
    const parsed = teacherSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '教师目录标识格式无效');
    const ids = parsed.data.ids === undefined ? null : parsed.data.ids.split(',');
    if (ids && (!ids.length || ids.length > 100 || ids.some((id) => !/^directory:[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length)) {
      return apiError(res, 400, 'VALIDATION_FAILED', '教师目录标识格式无效');
    }
    const targetIds = ids || db.prepare('SELECT directory_key FROM teachers ORDER BY directory_key').all().map((teacher) => teacher.directory_key);
    if (!targetIds.length) return res.json({ items: [] });
    const placeholders = targetIds.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT t.directory_key AS teacherId, COUNT(l.user_id) AS likeCount
      FROM teachers t LEFT JOIN teacher_likes l ON l.teacher_id = t.id
      WHERE t.directory_key IN (${placeholders})
      GROUP BY t.id, t.directory_key
      ORDER BY t.directory_key`).all(...targetIds);
    const likedKeys = req.user ? new Set(db.prepare(`SELECT t.directory_key FROM teachers t
      JOIN teacher_likes l ON l.teacher_id = t.id WHERE l.user_id = ? AND t.directory_key IN (${placeholders})`)
      .all(req.user.id, ...targetIds).map((teacher) => teacher.directory_key)) : null;
    res.json({ items: rows.map((row) => ({
      teacherId: row.teacherId,
      likeCount: Number(row.likeCount) || 0,
      ...(likedKeys ? { likedByMe: likedKeys.has(row.teacherId) } : {}),
    })) });
  }

  const api = express.Router();
  api.post('/auth/wechat', (_req, res) => apiError(res, 503, 'WECHAT_LOGIN_UNCONFIGURED', '真实微信登录尚未配置，无法完成身份认证'));
  api.post('/dev/sessions', (req, res) => {
    if (env === 'production') return apiError(res, 404, 'NOT_FOUND', '未找到资源');
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '开发测试会话仅接受账号标识');
    let user = db.prepare('SELECT id FROM users WHERE account_id = ?').get(parsed.data.accountId);
    if (!user) {
      user = { id: crypto.randomUUID() };
      db.prepare('INSERT INTO users (id, account_id, nickname) VALUES (?, ?, ?)')
        .run(user.id, parsed.data.accountId, '新同学');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))").run(tokenHash(token), user.id);
    res.status(201).json({ token, expiresInSeconds: 604800, mode: 'development-test-only' });
  });
  api.get('/profile', requireUser, (req, res) => res.json({
    bindingStatus: bindingStatus(req.user),
    nickname: req.user.nickname,
    avatarUrl: req.user.avatar_url,
    privateBinding: { name: req.user.legal_name, studentNumber: req.user.student_number },
  }));
  api.post('/profile/binding', requireUser, (req, res) => {
    const parsed = bindingSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '姓名和学号均为首次绑定必填项');
    if (bindingStatus(req.user) !== 'unbound') return apiError(res, 409, 'BINDING_ALREADY_EXISTS', '姓名和学号已绑定，身份资料修改入口待接入');
    const result = db.prepare(`UPDATE users SET legal_name = ?, student_number = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND legal_name IS NULL AND student_number IS NULL`)
      .run(parsed.data.name, parsed.data.studentNumber, req.user.id);
    if (!result.changes) return apiError(res, 409, 'BINDING_ALREADY_EXISTS', '姓名和学号已绑定，身份资料修改入口待接入');
    const user = db.prepare('SELECT nickname, avatar_url, legal_name, student_number FROM users WHERE id = ?').get(req.user.id);
    res.status(201).json({
      bindingStatus: bindingStatus(user),
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
      privateBinding: { name: user.legal_name, studentNumber: user.student_number },
    });
  });
  api.patch('/profile', requireUser, (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(req.body).length === 0) return apiError(res, 400, 'VALIDATION_FAILED', '仅可修改昵称和头像地址');
    const { nickname, avatarUrl } = parsed.data;
    db.prepare(`UPDATE users SET nickname = CASE WHEN ? THEN ? ELSE nickname END, avatar_url = CASE WHEN ? THEN ? ELSE avatar_url END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(nickname !== undefined ? 1 : 0, nickname ?? null, avatarUrl !== undefined ? 1 : 0, avatarUrl ?? null, req.user.id);
    const user = db.prepare('SELECT nickname, avatar_url FROM users WHERE id = ?').get(req.user.id);
    res.json({ nickname: user.nickname, avatarUrl: user.avatar_url });
  });
  api.post('/profile/change-requests', requireUser, (req, res) => {
    const parsed = changeRequestSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '姓名或学号修改申请格式无效');
    db.prepare('INSERT INTO profile_change_requests (id, user_id, requested_name, requested_student_number) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), req.user.id, parsed.data.name || null, parsed.data.studentNumber || null);
    res.status(201).json({ status: 'pending' });
  });
  api.get('/teachers/feedback-summary', optionalUser, teacherFeedbackSummary);
  for (const config of [
    { root: 'courses', param: 'courseKey', targetType: 'course', label: '课程' },
    { root: 'teachers', param: 'teacherId', targetType: 'teacher', label: '教师目录条目' },
  ]) {
    const target = entityByKey(`${config.targetType}s`, config.param, config.label);
    api.get(`/${config.root}/:${config.param}/feedback`, optionalUser, target, feedback(config.targetType));
    api.post(`/${config.root}/:${config.param}/likes`, requireUser, target, like(config.targetType));
    api.delete(`/${config.root}/:${config.param}/likes`, requireUser, target, unlike(config.targetType));
    api.post(`/${config.root}/:${config.param}/comments`, requireUser, target, comment(config.targetType));
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1', api);
  app.use('/api', api); // Legacy alias; /api/v1 is the documented contract.
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && error.status === 400) return apiError(res, 400, 'INVALID_JSON', '请求体不是有效 JSON');
    return apiError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
  });
  return app;
}

module.exports = { createApp, tokenHash };
