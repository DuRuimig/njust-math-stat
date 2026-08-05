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

正式生产运行需要设置 `NODE_ENV=production`、`DB_DRIVER=mysql` 及 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。微信云托管现有的 `MYSQL_ADDRESS=host:port`、`MYSQL_USERNAME` 可分别替代前两个连接变量。请将实际值仅存入云端密钥管理服务，禁止写入仓库或镜像。镜像默认仍使用 `DB_DRIVER=sqlite`，便于本地和独立体验构建；当前云托管体验版通过服务环境变量显式使用 MySQL，因此用户、会话、点赞和评论会保留在 MySQL 中，不随容器重建丢失。

应用启动不会执行 MySQL 建表或基础数据导入。已获得授权并在目标环境完成复核后，才可显式执行以下命令；两个命令都必须设置 `MYSQL_EXECUTE=1`，否则会在连接前明确拒绝。迁移命令会创建 `MYSQL_DATABASE` 指定的数据库（若尚不存在），然后应用幂等迁移：

```bash
cd project/backend
MYSQL_EXECUTE=1 npm run db:mysql:migrate
MYSQL_EXECUTE=1 npm run db:mysql:seed
```

MySQL seed 只导入课程定义和教师目录，不导入本地 SQLite 中的 users、sessions、likes、comments 或 profile 变更申请。迁移会创建管理员角色、审计日志及唯一主管理员记录所需的表，但不会写入任何人的姓名或学号。

微信云托管没有容器终端时，可临时配置 `MYSQL_BOOTSTRAP_ON_START=1` 发布一次。镜像会先显式运行上述 MySQL migration 和 seed，再按现有 `DB_DRIVER` 启动服务；确认迁移成功后必须删除此开关并重新发布。开关为 `0` 或不存在时，应用启动阶段不会主动执行 MySQL migration 或 seed。

## 云托管镜像构建

构建上下文必须是仓库根目录，Dockerfile 位于仓库根目录：

```bash
docker build -t njust-math-stat-backend .
docker run --rm -p 8080:8080 njust-math-stat-backend
```

容器启动命令为 `npm start`，运行时以非 root 用户执行、监听 `8080`，并在构建阶段从迁移与公共课程数据生成干净的 SQLite 体验版数据库。正式 MySQL 配置不应写入仓库或镜像。

教师目录页只展示当前课程库已录入的教师姓名、系别与累计点赞。点赞摘要通过 `GET /api/v1/teachers/feedback-summary` 批量读取，点赞通过 `POST /api/v1/teachers/:teacherId/likes` 写入；`teacherId` 使用课程库内目录链接（无链接时使用“姓名|系别”）的稳定 SHA-256 标识，前端与 seed 使用同一来源和口径。

## 上架版：微信登录与受邀使用

上架版的小程序默认使用真实微信登录。用户可匿名浏览课程与教师目录；首次参与点赞或评论时，需从邀请链接或小程序码进入 `pages/invite/index` 并完成微信登录。邀请码可重复使用，每位用户只会绑定一次受邀记录；停用邀请码组只阻止新成员加入，既有成员不受影响。

生产环境除 `WX_MINIPROGRAM_APP_ID`、`WX_MINIPROGRAM_APP_SECRET` 外，还需在云端密钥配置一个随机的 `INITIAL_ADMIN_INVITE_CODE`（6 至 20 位，允许英文、数字、`_`、`-`）。空库首次使用该码的微信账号会成为主管理员，并自动创建“初始管理员邀请”组；此后管理员可通过邀请组 API 创建、轮换和停用其他邀请码。初始邀请码应在首个主管理员创建完成后从云端环境变量删除。

创建或轮换邀请码时，管理员 API 的响应包含 `sharePath`，可用于小程序内的邀请链接。使用 `POST /api/v1/admin/invitation-groups/:groupId/mini-code` 并在请求体中提供同一个邀请码，会返回微信官方小程序码 PNG。邀请码数据库只保存哈希，服务不会在后续查询中回显明文；创建后应由管理员妥善保存邀请码及其链接或二维码。

小程序码使用微信 `wxacode.getUnlimited`，其 `scene` 最多支持 32 个可见字符。因此邀请码限制为 6 至 20 位，并且生成小程序码前 `pages/invite/index` 必须已随当前版本发布。

## 历史体验版：姓名学号测试身份

旧云端体验版曾使用姓名和 12 位数字学号进入测试身份：`POST /api/v1/auth/test-identity` 只在服务端环境变量 `ENABLE_TEST_IDENTITY_LOGIN=1` 且未开启邀请制时开放。同一学号会回到同一测试账号；姓名不一致会被拒绝，不会覆盖原资料。这个入口只用于内部体验，不能当作学校统一身份认证或正式权限依据。

测试身份成功后使用现有 7 天 Bearer 会话，可验证个人资料、点赞和匿名评论。测试身份开关与 MySQL 配置彼此独立：当前体验版已使用 MySQL 持久化互动数据；`MYSQL_EXECUTE=1` 仅用于受控迁移命令，不能作为常驻服务环境变量；微信 AppSecret 也不应写入仓库或镜像。

管理员分为一名主管理员和若干普通管理员。普通管理员可更正普通用户身份、封禁普通账号和删除违规评论；只有主管理员可授予或撤销普通管理员，并将主管理员身份移交给另一名已登录且未封禁的用户。移交后原主管理员保留普通管理员身份。首次主管理员只在系统尚未存在主管理员时由云端初始化配置指定，完成初始化后应删除该临时配置。

## 后续真实微信登录

小程序云模式调用 `wx.login` 获取一次性 `code`，通过既有 `wx.cloud.callContainer` 发送给 `POST /api/v1/auth/wechat`。服务端使用云环境变量中的凭据请求微信 `jscode2session`，只信任微信服务端响应的 OpenID；客户端提交的 OpenID、用户 ID 或资料字段均不会作为身份依据。服务端将内部命名空间化账号标识关联到现有 SQLite `users` 表，并返回 7 天有效、数据库仅保存哈希的随机 Bearer 会话。小程序仅保存 token、模式和过期时间；重启后会复用未过期会话，收到 `SESSION_INVALID` 或本地到期后会清除会话并要求重新登录。

最短云环境变量清单（仅在云托管环境变量或安全配置中设置，禁止写入 Git、前端、README 示例或日志）：

- `WX_MINIPROGRAM_APP_ID`：当前小程序的 AppID。
- `WX_MINIPROGRAM_APP_SECRET`：当前小程序 AppSecret，仅供服务端调用微信登录校验接口。

未配置上述变量时，登录接口返回 `WECHAT_LOGIN_UNCONFIGURED`，不会创建用户或会话。微信明确拒绝的无效或已使用 `code` 返回 `WECHAT_CODE_INVALID`；微信上游或服务端凭据异常返回 `WECHAT_AUTH_UNAVAILABLE`，不会向客户端暴露上游细节。`SESSION_INVALID` 表示 Bearer 会话不存在或已过期，小程序会清除本地会话，用户可重新登录。

仅开发环境可通过 `POST /api/v1/dev/sessions` 创建未绑定的本地开发测试会话；随后使用该会话的 `Authorization: Bearer <token>` 调用 `POST /api/v1/profile/binding`，完成首次姓名和学号绑定。该能力不是生产认证方案。除匿名读取反馈外，API 使用 `Authorization: Bearer <token>` 鉴权。

生产环境中 `/api/v1/dev/sessions` 返回 404；管理员 API 使用同一 Bearer 会话，并在服务端逐次校验管理员或主管理员权限。

## 小程序云托管调用

当前体验版显式使用云托管调用。云托管配置只包含环境与服务标识，不包含密钥、数据库连接信息或用户数据；本地开发时可将 `apiMode` 手动切回 `local`，调用 `http://127.0.0.1:2001`。

- 环境 ID：`prod-d5gfes93j0a83438c`
- 服务名：`express-4id4`
- 默认模式：`cloud`（体验版；本地开发需手动切换为 `local`）

云模式通过 `wx.cloud.callContainer` 的 `config.env` 与 `service` 参数调用服务，绝不会使用 `127.0.0.1`。当前源码默认 `authMode: "wechat"`：服务端以 `jscode2session` 校验微信登录 `code`，首次互动需验证邀请码；云托管路由信息不被当作用户身份凭据。

本地代码与自动化测试已覆盖该邀请流程；真实云托管、微信登录、小程序码、MySQL 和体验版上传仍需按 [`doc/cloud-container-integration.md`](doc/cloud-container-integration.md) 在目标环境逐项核验。
