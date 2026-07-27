# NJUST 数学统计课程目录

## 服务与数据库运行形态

- 前端预留端口：`1001`（本次不实现前端服务）
- 后端端口：`2001`
- SQLite 数据库：`database/runtime/njust-math-stat.sqlite`
- 数据库账号与密码：不适用（本地 SQLite 文件数据库）
- 生产数据库：正式环境默认使用环境变量配置的 MySQL；体验版镜像显式使用构建时生成的 SQLite 种子库，支持在云端安全配置微信凭据后使用真实微信登录。构建产物不含用户数据；运行期间产生的用户、会话、点赞、评论和资料变更数据受容器生命周期限制，容器重建或扩缩容后不保证持久化。

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

正式生产运行需要设置 `NODE_ENV=production`、`DB_DRIVER=mysql` 及 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。微信云托管现有的 `MYSQL_ADDRESS=host:port`、`MYSQL_USERNAME` 可分别替代前两个连接变量。请将实际值仅存入云端密钥管理服务，禁止写入仓库或镜像。体验版镜像显式设置 `DB_DRIVER=sqlite`，支持真实微信登录，但用户、会话和互动数据仅保存在当前容器实例中，不保证跨容器重建或扩缩容持久化。

应用启动不会执行 MySQL 建表或基础数据导入。已获得授权并在目标环境完成复核后，才可显式执行以下命令；两个命令都必须设置 `MYSQL_EXECUTE=1`，否则会在连接前明确拒绝。迁移命令会创建 `MYSQL_DATABASE` 指定的数据库（若尚不存在），然后应用幂等迁移：

```bash
cd project/backend
MYSQL_EXECUTE=1 npm run db:mysql:migrate
MYSQL_EXECUTE=1 npm run db:mysql:seed
```

MySQL seed 只导入课程定义和教师目录，不导入本地 SQLite 中的 users、sessions、likes、comments 或 profile 变更申请。迁移包含管理员准备表 `roles`、`user_roles`、`admin_audit_logs`，但不预置角色、不分配管理员、也不开放管理员 API。

微信云托管没有容器终端时，可临时配置 `MYSQL_BOOTSTRAP_ON_START=1` 并保持 `DB_DRIVER=sqlite` 发布一次。该镜像启动时会显式运行上述迁移和 seed，成功后继续启动 SQLite 服务；确认数据已创建后必须删除此开关，再单独设置 `DB_DRIVER=mysql` 发布。开关为 `0` 或不存在时，应用不会连接 MySQL 或执行迁移。

## 云托管镜像构建

构建上下文必须是仓库根目录，Dockerfile 位于仓库根目录：

```bash
docker build -t njust-math-stat-backend .
docker run --rm -p 8080:8080 njust-math-stat-backend
```

容器启动命令为 `npm start`，运行时以非 root 用户执行、监听 `8080`，并在构建阶段从迁移与公共课程数据生成干净的 SQLite 体验版数据库。正式 MySQL 配置不应写入仓库或镜像。

教师目录页只展示当前课程库已录入的教师姓名、系别与累计点赞。点赞摘要通过 `GET /api/v1/teachers/feedback-summary` 批量读取，点赞通过 `POST /api/v1/teachers/:teacherId/likes` 写入；`teacherId` 使用课程库内目录链接（无链接时使用“姓名|系别”）的稳定 SHA-256 标识，前端与 seed 使用同一来源和口径。

## 当前体验版：姓名学号测试身份

当前云端体验版默认使用姓名和 12 位数字学号进入测试身份：`POST /api/v1/auth/test-identity` 只在服务端环境变量 `ENABLE_TEST_IDENTITY_LOGIN=1` 时开放。同一学号会回到同一测试账号；姓名不一致会被拒绝，不会覆盖原资料。这个入口仅用于内部体验，知道姓名和学号的人可能进入同一账号，不能当作学校统一身份认证或正式权限依据。

测试身份成功后使用现有 7 天 Bearer 会话，可验证个人资料、点赞和匿名评论。云端开启体验版时只需设置非敏感开关 `ENABLE_TEST_IDENTITY_LOGIN=1`；不要因此配置真实 MySQL、`MYSQL_EXECUTE=1` 或微信 AppSecret。

## 后续真实微信登录

小程序云模式调用 `wx.login` 获取一次性 `code`，通过既有 `wx.cloud.callContainer` 发送给 `POST /api/v1/auth/wechat`。服务端使用云环境变量中的凭据请求微信 `jscode2session`，只信任微信服务端响应的 OpenID；客户端提交的 OpenID、用户 ID 或资料字段均不会作为身份依据。服务端将内部命名空间化账号标识关联到现有 SQLite `users` 表，并返回 7 天有效、数据库仅保存哈希的随机 Bearer 会话。小程序仅保存 token、模式和过期时间；重启后会复用未过期会话，收到 `SESSION_INVALID` 或本地到期后会清除会话并要求重新登录。

最短云环境变量清单（仅在云托管环境变量或安全配置中设置，禁止写入 Git、前端、README 示例或日志）：

- `WX_MINIPROGRAM_APP_ID`：当前小程序的 AppID。
- `WX_MINIPROGRAM_APP_SECRET`：当前小程序 AppSecret，仅供服务端调用微信登录校验接口。

未配置上述变量时，登录接口返回 `WECHAT_LOGIN_UNCONFIGURED`，不会创建用户或会话。微信明确拒绝的无效或已使用 `code` 返回 `WECHAT_CODE_INVALID`；微信上游或服务端凭据异常返回 `WECHAT_AUTH_UNAVAILABLE`，不会向客户端暴露上游细节。`SESSION_INVALID` 表示 Bearer 会话不存在或已过期，小程序会清除本地会话，用户可重新登录。

仅开发环境可通过 `POST /api/v1/dev/sessions` 创建未绑定的本地开发测试会话；随后使用该会话的 `Authorization: Bearer <token>` 调用 `POST /api/v1/profile/binding`，完成首次姓名和学号绑定。该能力不是生产认证方案。除匿名读取反馈外，API 使用 `Authorization: Bearer <token>` 鉴权。

生产环境中 `/api/v1/dev/sessions` 返回 404；管理员 API 仍未配置。

## 小程序云托管调用准备（未部署）

当前体验版显式使用云托管调用。云托管配置只包含环境与服务标识，不包含密钥、数据库连接信息或用户数据；本地开发时可将 `apiMode` 手动切回 `local`，调用 `http://127.0.0.1:2001`。

- 环境 ID：`prod-d5gfes93j0a83438c`
- 服务名：`express-4id4`
- 默认模式：`cloud`（体验版；本地开发需手动切换为 `local`）

云模式通过 `wx.cloud.callContainer` 的 `config.env` 与 `service` 参数调用服务，绝不会使用 `127.0.0.1`。当前默认 `authMode: "test-identity"`，个人资料、点赞与匿名评论使用测试身份的云托管 Bearer 会话；真实微信登录代码保留但当前不显示入口。云托管的调用路由信息不被当作用户身份凭据；后续微信版才由服务端 `jscode2session` 校验结果建立真实身份。

这只完成客户端调用准备：没有部署服务、修改云环境、接入 MySQL 或验证真实云调用。切换后的发布前检查与限制见 [`doc/cloud-container-integration.md`](doc/cloud-container-integration.md)。
