# 姓名学号测试身份 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让云端体验版使用姓名和 12 位学号进入稳定测试账号，同时保留但隐藏真实微信登录入口。

**Architecture:** 新增受 `ENABLE_TEST_IDENTITY_LOGIN=1` 保护的测试身份端点，repository 负责并发安全的测试用户查找或创建，现有随机 Bearer 会话继续承担互动鉴权。小程序通过 `authMode: "test-identity"` 选择登录 UI，并沿用延后持久化与会话竞态防护。

**Tech Stack:** Node.js 22、Express 4、Zod、SQLite/MySQL repository、Vitest、微信小程序 JavaScript/WXML/WXSS。

## Global Constraints

- 学号必须匹配 `/^\d{12}$/`。
- 页面称为“测试身份”，提示“不等同于学校统一身份认证或微信认证”。
- AI 页面不接模型、RAG 或 AI API。
- 不连接真实 MySQL，不设置 `MYSQL_EXECUTE=1`。
- 真实微信登录代码保留，当前入口隐藏。
- 本轮不暂存、不提交、不推送、不部署。

---

### Task 1: 服务端测试身份端点

**Files:**
- Modify: `project/backend/src/app.js`
- Modify: `project/backend/src/repository.js`
- Modify: `.env.example`
- Test: `project/backend/test/api.test.js`
- Test: `project/backend/test/repository.test.js`

**Interfaces:**
- Consumes: `createRepository(db)`、现有 `tokenHash(token)` 与 `sessions` 表。
- Produces: `POST /api/v1/auth/test-identity` 和 repository 方法 `findOrCreateTestIdentity(accountId, id, name, studentNumber)`。

- [ ] **Step 1: 写失败测试**

覆盖开关关闭 404、12 位学号、首次/重复进入同一账号、姓名冲突 409、并发首次进入。

```js
const response = await request(testIdentityApp)
  .post('/api/v1/auth/test-identity')
  .send({ name: '测试姓名', studentNumber: '123456789012' });
expect(response.status).toBe(201);
expect(response.body).toMatchObject({ mode: 'test-identity', expiresInSeconds: 604800 });
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `cd project/backend && npm test -- --reporter=dot test/api.test.js test/repository.test.js`

Expected: 新端点返回 404 或 repository 方法不存在。

- [ ] **Step 3: 最小实现**

```js
const testIdentitySchema = z.object({
  name: z.string().trim().min(1).max(80),
  studentNumber: z.string().trim().regex(/^\d{12}$/),
}).strict();

const testIdentityAccountId = (studentNumber) =>
  `test-identity:${crypto.createHash('sha256').update(studentNumber).digest('hex')}`;
```

端点仅在 `testIdentityLoginEnabled` 为真时开放；repository 原子创建已绑定用户，唯一冲突后重新读取；已有姓名不一致返回 `TEST_IDENTITY_MISMATCH`。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `cd project/backend && npm test -- --reporter=dot test/api.test.js test/repository.test.js`

Expected: 两个测试文件全部通过。

### Task 2: 小程序 API 与测试模式 UI

**Files:**
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/utils/api.js`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `miniprogram/pages/profile/index.wxss`
- Test: `project/backend/test/miniprogram-api.test.js`

**Interfaces:**
- Consumes: `POST /api/v1/auth/test-identity` 返回 `{ token, mode: "test-identity", expiresInSeconds }`。
- Produces: `api.loginWithTestIdentity(identity, options)`、`globalData.authMode`、个人中心测试身份表单。

- [ ] **Step 1: 写失败测试**

```js
await expect(api.loginWithTestIdentity(
  { name: '测试姓名', studentNumber: '123456789012' },
  { deferPersist: true },
)).resolves.toMatchObject({ mode: 'test-identity' });
```

同时断言 11/13 位或含非数字的学号在客户端拒绝、请求不带 Bearer、重复点击不重复请求、成功后读取绑定资料、页面没有微信登录按钮。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `cd project/backend && npm test -- --reporter=dot test/miniprogram-api.test.js`

Expected: `loginWithTestIdentity` 不存在或测试模式页面行为不符。

- [ ] **Step 3: 最小实现**

```js
function loginWithTestIdentity(identity, options) {
  var name = cleanText(identity && identity.name, 80)
  var studentNumber = cleanText(identity && identity.studentNumber, 12)
  if (!name || !/^\d{12}$/.test(studentNumber)) {
    return Promise.reject(apiError('请填写姓名和 12 位学号', 'INVALID_TEST_IDENTITY'))
  }
  return request({
    method: 'POST',
    path: API_PREFIX + '/auth/test-identity',
    auth: false,
    data: { name: name, studentNumber: studentNumber }
  }).then(function (payload) {
    if (!payload || typeof payload.token !== 'string' || payload.mode !== 'test-identity') {
      throw apiError('测试身份响应无效', 'INVALID_SESSION_RESPONSE')
    }
    return deferSessionPersistence(options) ? payload : persistSession(payload)
  })
}
```

个人中心在 `authMode === "test-identity"` 时展示姓名、12 位数字学号、提示文案与单一进入按钮；微信按钮只在 `authMode === "wechat"` 时展示。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `cd project/backend && npm test -- --reporter=dot test/miniprogram-api.test.js`

Expected: 小程序 API 与页面测试全部通过。

### Task 3: 文档与全量验收

**Files:**
- Modify: `README.md`
- Modify: `doc/backend-api-and-privacy.md`
- Modify: `doc/cloud-container-integration.md`

**Interfaces:**
- Consumes: Task 1 与 Task 2 的最终端点、开关和 UI 文案。
- Produces: 可交给 Crow5 的当前能力与发布边界说明。

- [ ] **Step 1: 更新文档**

记录 `ENABLE_TEST_IDENTITY_LOGIN=1`、12 位规则、测试身份风险、微信入口隐藏，以及真实微信登录和 AI 均不在当前体验版启用。

- [ ] **Step 2: 运行全量验收**

Run: `cd project/backend && npm run check`

Run: `cd project/backend && npm test -- --reporter=dot`

Run: `find miniprogram -name '*.js' -type f -print0 | xargs -0 -n1 node --check`

Run: `git diff --check 1b66e5f`

Expected: 全部退出码为 0，敏感值扫描无命中。

- [ ] **Step 3: 核对发布边界**

确认 `git diff --cached --name-only` 为空；Docker 未启动时明确保留容器和 `/health` 未验证状态；生成新的 Crow5 审查说明并停在提交前。
