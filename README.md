# NJUST 数学统计课程目录

## 本地服务

- 前端预留端口：`1001`（本次不实现前端服务）
- 后端端口：`2001`
- SQLite 数据库：`database/runtime/njust-math-stat.sqlite`
- 数据库账号与密码：不适用（本地 SQLite 文件数据库）

## 后端启动

```bash
cd project/backend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

健康检查：`GET http://localhost:2001/health`。主 API 契约为 `http://localhost:2001/api/v1`；旧 `/api` 仅保留兼容入口。

教师目录页只展示当前课程库已录入的教师姓名、系别与累计点赞。点赞摘要通过 `GET /api/v1/teachers/feedback-summary` 批量读取，点赞通过 `POST /api/v1/teachers/:teacherId/likes` 写入；`teacherId` 使用课程库内目录链接（无链接时使用“姓名|系别”）的稳定 SHA-256 标识，前端与 seed 使用同一来源和口径。

## 登录限制

当前没有真实微信登录的 AppID、AppSecret、回调配置或服务端换取身份的配置。`POST /api/v1/auth/wechat` 会明确返回未配置状态，绝不会伪造微信身份。

仅开发环境可通过 `POST /api/v1/dev/sessions` 创建未绑定的本地开发测试会话；随后使用该会话的 `Authorization: Bearer <token>` 调用 `POST /api/v1/profile/binding`，完成首次姓名和学号绑定。该能力不是生产认证方案。除匿名读取反馈外，API 使用 `Authorization: Bearer <token>` 鉴权。
