# NJUST 数学统计课程目录

## 服务与数据库运行形态

- 前端预留端口：`1001`（本次不实现前端服务）
- 后端端口：`2001`
- SQLite 数据库：`database/runtime/njust-math-stat.sqlite`
- 数据库账号与密码：不适用（本地 SQLite 文件数据库）
- 生产数据库：正式环境默认使用环境变量配置的 MySQL；体验版镜像显式使用构建时生成的 SQLite 种子库，不含任何用户数据，容器重建后互动数据会重置。

## 后端启动

```bash
cd project/backend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

健康检查：`GET http://localhost:2001/health`。主 API 契约为 `http://localhost:2001/api/v1`；旧 `/api` 仅保留兼容入口。服务会校验 `PORT` 为有效 TCP 端口，并监听 `0.0.0.0`。

## MySQL 生产准备（不自动执行）

正式生产运行需要设置 `NODE_ENV=production`、`DB_DRIVER=mysql` 及 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。请将实际值仅存入云端密钥管理服务，禁止写入仓库或镜像。体验版镜像显式设置 `DB_DRIVER=sqlite`，仅用于无真实登录和无持久互动数据的预览。

应用启动不会执行 MySQL 建表或基础数据导入。已获得授权并在目标环境完成复核后，才可显式执行以下命令；两个命令都必须设置 `MYSQL_EXECUTE=1`，否则会在连接前明确拒绝：

```bash
cd project/backend
MYSQL_EXECUTE=1 npm run db:mysql:migrate
MYSQL_EXECUTE=1 npm run db:mysql:seed
```

MySQL seed 只导入课程定义和教师目录，不导入本地 SQLite 中的 users、sessions、likes、comments 或 profile 变更申请。迁移包含管理员准备表 `roles`、`user_roles`、`admin_audit_logs`，但不预置角色、不分配管理员、也不开放管理员 API。

## 云托管镜像构建

构建上下文必须是仓库根目录，Dockerfile 位于仓库根目录：

```bash
docker build -t njust-math-stat-backend .
docker run --rm -p 8080:8080 njust-math-stat-backend
```

容器启动命令为 `npm start`，运行时以非 root 用户执行、监听 `8080`，并在构建阶段从迁移与公共课程数据生成干净的 SQLite 体验版数据库。正式 MySQL 配置不应写入仓库或镜像。

教师目录页只展示当前课程库已录入的教师姓名、系别与累计点赞。点赞摘要通过 `GET /api/v1/teachers/feedback-summary` 批量读取，点赞通过 `POST /api/v1/teachers/:teacherId/likes` 写入；`teacherId` 使用课程库内目录链接（无链接时使用“姓名|系别”）的稳定 SHA-256 标识，前端与 seed 使用同一来源和口径。

## 登录限制

当前没有真实微信登录的 AppID、AppSecret、回调配置或服务端换取身份的配置。`POST /api/v1/auth/wechat` 会明确返回未配置状态，绝不会伪造微信身份。

仅开发环境可通过 `POST /api/v1/dev/sessions` 创建未绑定的本地开发测试会话；随后使用该会话的 `Authorization: Bearer <token>` 调用 `POST /api/v1/profile/binding`，完成首次姓名和学号绑定。该能力不是生产认证方案。除匿名读取反馈外，API 使用 `Authorization: Bearer <token>` 鉴权。

生产环境中 `/api/v1/dev/sessions` 返回 404；真实微信登录和管理员 API 均尚未配置。

## 小程序云托管调用准备（未部署）

当前体验版显式使用云托管调用。云托管配置只包含环境与服务标识，不包含密钥、数据库连接信息或用户数据；本地开发时可将 `apiMode` 手动切回 `local`，调用 `http://127.0.0.1:2001`。

- 环境 ID：`prod-d5gfes93j0a83438c`
- 服务名：`express-4id4`
- 默认模式：`cloud`（体验版；本地开发需手动切换为 `local`）

云模式通过 `wx.cloud.callContainer` 的 `config.env` 与 `service` 参数调用服务，绝不会使用 `127.0.0.1`。体验版没有真实微信登录，因此不提供本地开发测试身份、身份资料写入、点赞或匿名评论；Bearer 会话仅在未来真实认证接入后使用。

这只完成客户端调用准备：没有部署服务、修改云环境、接入 MySQL 或验证真实云调用。切换后的发布前检查与限制见 [`doc/cloud-container-integration.md`](doc/cloud-container-integration.md)。
