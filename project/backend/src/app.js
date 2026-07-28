const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { z } = require('zod');
const { createRepository } = require('./repository');
const { createWechatAuth, WechatAuthError } = require('./wechat-auth');

const sessionSchema = z.object({
  accountId: z.string().trim().min(3).max(80),
}).strict();
const wechatLoginSchema = z.object({
  code: z.string().trim().min(6).max(512),
}).strict();
const testIdentitySchema = z.object({
  name: z.string().trim().min(1).max(80),
  studentNumber: z.string().trim().regex(/^\d{12}$/),
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
const adminUserQuerySchema = z.object({ q: z.string().trim().min(1).max(80) }).strict();
const adminIdentitySchema = z.object({
  name: z.string().trim().min(1).max(80),
  studentNumber: z.string().trim().regex(/^\d{12}$/),
}).strict();
const adminAccountStatusSchema = z.object({ banned: z.boolean() }).strict();
const adminRoleSchema = z.object({ isAdmin: z.boolean() }).strict();
const teacherSummaryQuerySchema = z.object({
  ids: z.string().max(6600).optional(),
}).strict();
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const wechatAccountId = (openid) => `wechat:${crypto.createHash('sha256').update(openid).digest('hex')}`;
const testIdentityAccountId = (studentNumber) => `test-identity:${crypto.createHash('sha256').update(studentNumber).digest('hex')}`;
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function bindingStatus(user) {
  if (user.legal_name && user.student_number) return 'bound';
  if (user.legal_name || user.student_number) return 'partial';
  return 'unbound';
}

function decodeTargetKey(value) {
  const key = String(value || '');
  try {
    // Some Cloud Run gateways forward an already-escaped dynamic path segment.
    const decoded = decodeURIComponent(key);
    // Some device JavaScript runtimes preserve full-width punctuation in course names.
    // Course seed keys are NFKC-normalized with whitespace removed.
    return decoded.normalize('NFKC').replace(/\s+/g, '');
  } catch (_error) {
    return key.normalize('NFKC').replace(/\s+/g, '');
  }
}

function createApp({ db, env = process.env.NODE_ENV || 'development', logger = pino({ enabled: process.env.NODE_ENV !== 'test' }), wechatAuth = createWechatAuth(), testIdentityLoginEnabled = process.env.ENABLE_TEST_IDENTITY_LOGIN === '1', initialAdminAccountId = process.env.INITIAL_ADMIN_ACCOUNT_ID || '' } = {}) {
  if (!db) throw new Error('createApp requires an initialized database connection');
  const repository = createRepository(db);
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run terminates one trusted proxy before this process. Without this,
  // express-rate-limit rejects every cloud call carrying X-Forwarded-For.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env === 'production' ? false : true }));
  app.use(express.json({ limit: '16kb' }));
  // Do not serialize request headers or bodies: they may contain tokens or private content.
  app.use(pinoHttp({ logger, serializers: { req: () => undefined, res: () => undefined } }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => apiError(res, 429, 'RATE_LIMITED', '请求过于频繁，请稍后重试') }));

  async function optionalUser(req, res, next) {
    const authorization = req.get('authorization');
    if (!authorization) return next();
    if (!authorization.startsWith('Bearer ')) return apiError(res, 401, 'AUTH_REQUIRED', '需要有效会话');
    const user = await repository.findSession(tokenHash(authorization.slice(7)));
    if (!user) return apiError(res, 401, 'SESSION_INVALID', '会话无效或已过期');
    req.user = user;
    next();
  }
  async function requireUser(req, res, next) {
    await optionalUser(req, res, () => req.user ? next() : apiError(res, 401, 'AUTH_REQUIRED', '需要有效会话'));
  }
  async function requireAdmin(req, res, next) {
    if (!await repository.isAdmin(req.user.id)) return apiError(res, 403, 'ADMIN_REQUIRED', '需要管理员权限');
    next();
  }
  async function requirePrimaryAdmin(req, res, next) {
    if (!await repository.isPrimaryAdmin(req.user.id)) return apiError(res, 403, 'PRIMARY_ADMIN_REQUIRED', '需要主管理员权限');
    next();
  }
  function entityByKey(table, param, label) {
    const type = table === 'courses' ? 'course' : 'teacher';
    return asyncHandler(async (req, res, next) => {
      const receivedKey = String(req.params[param] || '');
      const decodedKey = decodeTargetKey(receivedKey);
      const entity = await repository.findTarget(type, decodedKey);
      if (!entity) {
        // This is emitted only for a public course or teacher key mismatch.
        // Request headers, bodies, and the authenticated user remain excluded from logs.
        logger.warn({ targetType: type, method: req.method, receivedKey, decodedKey }, '[course-target-not-found]');
        return apiError(res, 404, 'TARGET_NOT_FOUND', `${label}不存在`);
      }
      req.target = entity;
      next();
    });
  }
  function feedback(targetType) {
    return async (req, res) => {
      const result = await repository.feedback(targetType, req.target.id, req.user && req.user.id);
      const isAdmin = req.user ? await repository.isAdmin(req.user.id) : false;
      const comments = result.comments
        .map((item) => ({
          id: item.id,
          content: item.body,
          authorNickname: item.author_nickname || '新同学',
          createdAt: item.created_at,
          anonymous: true,
          canDelete: Boolean(req.user && item.user_id === req.user.id),
          canModerate: isAdmin,
        }));
      res.json({ likeCount: result.likeCount, likedByMe: result.liked, comments });
    };
  }
  function like(targetType) {
    return async (req, res) => {
      const result = await repository.like(targetType, req.user.id, req.target.id);
      res.status(result.created ? 201 : 200).json({ liked: true, alreadyLiked: !result.created, likeCount: result.likeCount });
    };
  }
  function unlike(targetType) {
    return async (req, res) => {
      const likeCount = await repository.unlike(targetType, req.user.id, req.target.id);
      res.json({ liked: false, likeCount });
    };
  }
  function comment(targetType) {
    return async (req, res) => {
      const parsed = commentSchema.safeParse(req.body);
      if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '评论需为 1 至 300 个字符');
      if (targetType === 'teacher') {
        const liked = await repository.canComment(targetType, req.user.id, req.target.id);
        if (!liked) return apiError(res, 403, 'LIKE_REQUIRED', '点赞后才能评价教师');
      }
      const id = crypto.randomUUID();
      const created = await repository.createComment(targetType, id, req.user.id, req.target.id, parsed.data.content);
      res.status(201).json({ comment: { id: created.id, content: created.body, authorNickname: created.author_nickname || '新同学', createdAt: created.created_at, anonymous: true, canDelete: true, canModerate: await repository.isAdmin(req.user.id) } });
    };
  }
  function deleteComment(targetType) {
    return async (req, res) => {
      const commentId = String(req.params.commentId || '');
      if (!/^[0-9a-f-]{36}$/i.test(commentId)) return apiError(res, 400, 'VALIDATION_FAILED', '评论标识格式无效');
      const comment = await repository.findComment(targetType, commentId, req.target.id);
      if (!comment) return apiError(res, 404, 'COMMENT_NOT_FOUND', '评论不存在');
      const isAdmin = await repository.isAdmin(req.user.id);
      if (comment.user_id !== req.user.id && !isAdmin) return apiError(res, 403, 'COMMENT_DELETE_FORBIDDEN', '只能删除自己的评论');
      await repository.deleteComment(targetType, commentId, req.target.id);
      if (isAdmin) await repository.writeAdminAudit(crypto.randomUUID(), req.user.id, 'delete_comment', `${targetType}_comment`, commentId);
      res.status(204).end();
    };
  }
  async function teacherFeedbackSummary(req, res) {
    const parsed = teacherSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '教师目录标识格式无效');
    const ids = parsed.data.ids === undefined ? null : parsed.data.ids.split(',');
    if (ids && (!ids.length || ids.length > 100 || ids.some((id) => !/^directory:[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length)) {
      return apiError(res, 400, 'VALIDATION_FAILED', '教师目录标识格式无效');
    }
    const targetIds = ids || (await repository.allTeacherKeys()).map((teacher) => teacher.directory_key);
    if (!targetIds.length) return res.json({ items: [] });
    res.json({ items: await repository.teacherSummary(targetIds, req.user && req.user.id) });
  }

  const api = express.Router();
  api.post('/auth/wechat', asyncHandler(async (req, res) => {
    const parsed = wechatLoginSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '微信登录凭据格式无效');
    let identity;
    try {
      identity = await wechatAuth(parsed.data.code);
    } catch (error) {
      if (error instanceof WechatAuthError) {
        const status = error.code === 'WECHAT_LOGIN_UNCONFIGURED' ? 503 : error.code === 'WECHAT_CODE_INVALID' ? 401 : 502;
        return apiError(res, status, error.code, error.message);
      }
      throw error;
    }
    // Keep the WeChat identity in process memory only long enough to derive its internal account key.
    const accountId = wechatAccountId(identity.openid);
    const user = await repository.findOrCreateUser(accountId, crypto.randomUUID());
    if (user.is_banned) return apiError(res, 403, 'ACCOUNT_BANNED', '该账号已被管理员封禁');
    const token = crypto.randomBytes(32).toString('base64url');
    await repository.createSession(tokenHash(token), user.id);
    res.status(201).json({ token, expiresInSeconds: 604800, mode: 'wechat' });
  }));
  api.post('/auth/test-identity', asyncHandler(async (req, res) => {
    if (!testIdentityLoginEnabled) return apiError(res, 404, 'NOT_FOUND', '未找到资源');
    const parsed = testIdentitySchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '请填写姓名和 12 位学号');
    const { name, studentNumber } = parsed.data;
    const accountId = testIdentityAccountId(studentNumber);
    const user = await repository.findOrCreateTestIdentity(accountId, crypto.randomUUID(), name, studentNumber);
    if (user.legal_name !== name || user.student_number !== studentNumber) {
      return apiError(res, 409, 'TEST_IDENTITY_MISMATCH', '该学号已被不同姓名的测试身份使用');
    }
    if (user.is_banned) return apiError(res, 403, 'ACCOUNT_BANNED', '该账号已被管理员封禁');
    if (initialAdminAccountId && accountId === initialAdminAccountId) await repository.ensureInitialPrimaryAdmin(user.id);
    const token = crypto.randomBytes(32).toString('base64url');
    await repository.createSession(tokenHash(token), user.id);
    res.status(201).json({ token, expiresInSeconds: 604800, mode: 'test-identity' });
  }));
  api.post('/dev/sessions', asyncHandler(async (req, res) => {
    if (env === 'production') return apiError(res, 404, 'NOT_FOUND', '未找到资源');
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '开发测试会话仅接受账号标识');
    let user = await repository.findUserByAccount(parsed.data.accountId);
    if (!user) {
      user = { id: crypto.randomUUID() };
      await repository.createUser(user.id, parsed.data.accountId);
    }
    if (user.is_banned) return apiError(res, 403, 'ACCOUNT_BANNED', '该账号已被管理员封禁');
    const token = crypto.randomBytes(32).toString('base64url');
    await repository.createSession(tokenHash(token), user.id);
    res.status(201).json({ token, expiresInSeconds: 604800, mode: 'development-test-only' });
  }));
  api.get('/profile', asyncHandler(requireUser), asyncHandler(async (req, res) => {
    if (initialAdminAccountId && req.user.account_id === initialAdminAccountId) await repository.ensureInitialPrimaryAdmin(req.user.id);
    res.json({
      userId: req.user.id,
      bindingStatus: bindingStatus(req.user),
      nickname: req.user.nickname,
      avatarUrl: req.user.avatar_url,
      privateBinding: { name: req.user.legal_name, studentNumber: req.user.student_number },
      isAdmin: await repository.isAdmin(req.user.id),
      isPrimaryAdmin: await repository.isPrimaryAdmin(req.user.id),
    });
  }));
  api.post('/profile/binding', asyncHandler(requireUser), asyncHandler(async (req, res) => {
    const parsed = bindingSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '姓名和学号均为首次绑定必填项');
    if (bindingStatus(req.user) !== 'unbound') return apiError(res, 409, 'BINDING_ALREADY_EXISTS', '姓名和学号已绑定，身份资料修改入口待接入');
    const result = await repository.bindProfile(parsed.data.name, parsed.data.studentNumber, req.user.id);
    if (!result.changes) return apiError(res, 409, 'BINDING_ALREADY_EXISTS', '姓名和学号已绑定，身份资料修改入口待接入');
    const user = await repository.profile(req.user.id);
    res.status(201).json({
      userId: req.user.id,
      bindingStatus: bindingStatus(user),
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
      privateBinding: { name: user.legal_name, studentNumber: user.student_number },
      isAdmin: await repository.isAdmin(req.user.id),
      isPrimaryAdmin: await repository.isPrimaryAdmin(req.user.id),
    });
  }));
  api.patch('/profile', asyncHandler(requireUser), asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(req.body).length === 0) return apiError(res, 400, 'VALIDATION_FAILED', '仅可修改昵称和头像地址');
    const { nickname, avatarUrl } = parsed.data;
    await repository.updateProfile(nickname, avatarUrl, req.user.id);
    const user = await repository.profile(req.user.id);
    res.json({ nickname: user.nickname, avatarUrl: user.avatar_url });
  }));
  api.post('/profile/change-requests', asyncHandler(requireUser), asyncHandler(async (req, res) => {
    const parsed = changeRequestSchema.safeParse(req.body);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '姓名或学号修改申请格式无效');
    await repository.createChangeRequest(crypto.randomUUID(), req.user.id, parsed.data.name, parsed.data.studentNumber);
    res.status(201).json({ status: 'pending' });
  }));
  api.get('/admin/users', asyncHandler(requireUser), asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
    const parsed = adminUserQuerySchema.safeParse(req.query);
    if (!parsed.success) return apiError(res, 400, 'VALIDATION_FAILED', '请输入姓名或学号搜索用户');
    const items = await repository.listUsersForAdmin(parsed.data.q);
    res.json({ items: items.map((user) => ({ id: user.id, name: user.legal_name, studentNumber: user.student_number, isBanned: Boolean(user.is_banned), isAdmin: Boolean(user.is_admin), isPrimaryAdmin: Boolean(user.is_primary_admin), createdAt: user.created_at })) });
  }));
  api.patch('/admin/users/:userId/identity', asyncHandler(requireUser), asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
    const parsed = adminIdentitySchema.safeParse(req.body);
    const userId = String(req.params.userId || '');
    if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(userId)) return apiError(res, 400, 'VALIDATION_FAILED', '姓名和 12 位学号格式无效');
    const result = await repository.adminUpdateIdentity(req.user.id, userId, parsed.data.name, parsed.data.studentNumber, testIdentityAccountId(parsed.data.studentNumber), crypto.randomUUID());
    if (result.actorNotAdmin) return apiError(res, 403, 'ADMIN_REQUIRED', '需要管理员权限');
    if (result.missing) return apiError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    if (result.protectedAdmin) return apiError(res, 403, 'ADMIN_TARGET_PROTECTED', '普通管理员不能修改其他管理员');
    if (result.conflict) return apiError(res, 409, 'STUDENT_NUMBER_IN_USE', '该学号已被其他用户使用');
    res.json({ user: { id: userId, name: parsed.data.name, studentNumber: parsed.data.studentNumber } });
  }));
  api.patch('/admin/users/:userId/account-status', asyncHandler(requireUser), asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
    const parsed = adminAccountStatusSchema.safeParse(req.body);
    const userId = String(req.params.userId || '');
    if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(userId)) return apiError(res, 400, 'VALIDATION_FAILED', '账号状态格式无效');
    if (parsed.data.banned && userId === req.user.id) return apiError(res, 400, 'SELF_BAN_FORBIDDEN', '不能封禁当前管理员账号');
    if (await repository.isAdmin(userId) && !await repository.isPrimaryAdmin(req.user.id)) return apiError(res, 403, 'ADMIN_TARGET_PROTECTED', '普通管理员不能封禁其他管理员');
    const result = await repository.adminSetUserBanned(req.user.id, userId, parsed.data.banned, crypto.randomUUID());
    if (result.actorNotAdmin) return apiError(res, 403, 'ADMIN_REQUIRED', '需要管理员权限');
    if (result.missing) return apiError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    if (result.selfBan) return apiError(res, 400, 'SELF_BAN_FORBIDDEN', '不能封禁当前管理员账号');
    if (result.protectedAdmin) return apiError(res, 403, 'ADMIN_TARGET_PROTECTED', '普通管理员不能封禁其他管理员');
    res.json({ user: { id: userId, isBanned: parsed.data.banned } });
  }));
  api.delete('/admin/users/:userId', asyncHandler(requireUser), asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return apiError(res, 400, 'VALIDATION_FAILED', '账号标识格式无效');
    const result = await repository.adminDeleteUser(req.user.id, userId, crypto.randomUUID());
    if (result.actorNotAdmin) return apiError(res, 403, 'ADMIN_REQUIRED', '需要管理员权限');
    if (result.missing) return apiError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    if (result.selfDelete) return apiError(res, 400, 'SELF_DELETE_FORBIDDEN', '不能删除当前管理员账号');
    if (result.protectedAdmin) return apiError(res, 403, 'ADMIN_TARGET_PROTECTED', '普通管理员不能删除其他管理员');
    if (result.primaryAdmin) return apiError(res, 409, 'PRIMARY_ADMIN_DELETE_FORBIDDEN', '主管理员不能被删除，请先移交主管理员权限');
    res.status(204).end();
  }));
  api.patch('/admin/users/:userId/admin-role', asyncHandler(requireUser), asyncHandler(requirePrimaryAdmin), asyncHandler(async (req, res) => {
    const parsed = adminRoleSchema.safeParse(req.body);
    const userId = String(req.params.userId || '');
    if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(userId)) return apiError(res, 400, 'VALIDATION_FAILED', '管理员权限格式无效');
    if (userId === req.user.id) return apiError(res, 400, 'SELF_ADMIN_ROLE_CHANGE_FORBIDDEN', '不能修改当前主管理员的管理员权限');
    const result = await repository.adminSetUserRole(req.user.id, userId, parsed.data.isAdmin, crypto.randomUUID());
    if (result.actorNotPrimary) return apiError(res, 403, 'PRIMARY_ADMIN_REQUIRED', '需要主管理员权限');
    if (result.missing) return apiError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    if (result.banned) return apiError(res, 409, 'BANNED_USER_ROLE_CHANGE_FORBIDDEN', '请先解除该账号的封禁');
    if (result.selfRole) return apiError(res, 400, 'SELF_ADMIN_ROLE_CHANGE_FORBIDDEN', '不能修改当前主管理员的管理员权限');
    if (result.primaryAdmin) return apiError(res, 409, 'PRIMARY_ADMIN_ROLE_PROTECTED', '主管理员必须先移交权限');
    res.json({ user: { id: userId, isAdmin: parsed.data.isAdmin } });
  }));
  api.patch('/admin/users/:userId/primary-admin', asyncHandler(requireUser), asyncHandler(requirePrimaryAdmin), asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return apiError(res, 400, 'VALIDATION_FAILED', '主管理员目标无效');
    if (userId === req.user.id) return apiError(res, 400, 'PRIMARY_ADMIN_ALREADY_ASSIGNED', '当前账号已经是主管理员');
    const result = await repository.transferPrimaryAdmin(req.user.id, userId, crypto.randomUUID());
    if (result.actorNotPrimary) return apiError(res, 403, 'PRIMARY_ADMIN_REQUIRED', '需要主管理员权限');
    if (result.missing) return apiError(res, 404, 'USER_NOT_FOUND', '用户不存在');
    if (result.banned) return apiError(res, 409, 'BANNED_USER_ROLE_CHANGE_FORBIDDEN', '请先解除该账号的封禁');
    if (result.alreadyAssigned) return apiError(res, 400, 'PRIMARY_ADMIN_ALREADY_ASSIGNED', '当前账号已经是主管理员');
    if (result.missingAssignment) return apiError(res, 409, 'PRIMARY_ADMIN_NOT_INITIALIZED', '主管理员尚未完成初始化');
    res.json({ user: { id: userId, isAdmin: true, isPrimaryAdmin: true } });
  }));
  api.get('/teachers/feedback-summary', asyncHandler(optionalUser), asyncHandler(teacherFeedbackSummary));
  for (const config of [
    { root: 'courses', param: 'courseKey', targetType: 'course', label: '课程' },
    { root: 'teachers', param: 'teacherId', targetType: 'teacher', label: '教师目录条目' },
  ]) {
    const target = entityByKey(`${config.targetType}s`, config.param, config.label);
    api.get(`/${config.root}/:${config.param}/feedback`, asyncHandler(optionalUser), target, asyncHandler(feedback(config.targetType)));
    api.post(`/${config.root}/:${config.param}/likes`, asyncHandler(requireUser), target, asyncHandler(like(config.targetType)));
    api.delete(`/${config.root}/:${config.param}/likes`, asyncHandler(requireUser), target, asyncHandler(unlike(config.targetType)));
    api.post(`/${config.root}/:${config.param}/comments`, asyncHandler(requireUser), target, asyncHandler(comment(config.targetType)));
    api.delete(`/${config.root}/:${config.param}/comments/:commentId`, asyncHandler(requireUser), target, asyncHandler(deleteComment(config.targetType)));
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
