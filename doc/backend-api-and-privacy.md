# 后端 API 与隐私边界

## 主契约

主 API 前缀为 `/api/v1`。历史 `/api` 路径只作为兼容别名，不应新增调用。所有错误响应使用 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 服务健康检查 |
| POST | `/api/v1/auth/test-identity` | 否，仅 `ENABLE_TEST_IDENTITY_LOGIN=1` | 姓名和 12 位学号进入内部测试身份 |
| POST | `/api/v1/auth/wechat` | 否 | 仅接受一次性 `code` 与可选邀请码；服务端校验微信身份后建立会话 |
| POST | `/api/v1/dev/sessions` | 否，仅非生产 | 创建未绑定的本地开发测试会话 |
| GET/PATCH | `/api/v1/profile` | Bearer | 读取本人资料；当前小程序仅更新昵称，服务端头像字段仍只接受标准 URL |
| POST | `/api/v1/profile/binding` | Bearer | 完成首次姓名、学号绑定 |
| POST | `/api/v1/profile/change-requests` | Bearer | 提交姓名或学号修改申请 |
| GET | `/api/v1/courses/:courseKey/feedback` | 可选 Bearer | 返回 `likeCount`、`likedByMe` 和匿名评论 |
| POST | `/api/v1/courses/:courseKey/likes` | Bearer | 课程点赞，重复请求返回已点赞状态 |
| POST | `/api/v1/courses/:courseKey/comments` | Bearer | 已点赞后匿名评论，字段为 `content` |
| GET | `/api/v1/teachers/feedback-summary?ids=:teacherId,...` | 可选 Bearer | 批量返回教师 `teacherId`、`likeCount`；有会话时附 `likedByMe` |
| POST | `/api/v1/teachers/:teacherId/likes` | Bearer | 教师一次点赞，重复请求返回已点赞状态 |
| GET | `/api/v1/invitations/status` | Bearer | 返回当前账号是否已受邀及所属邀请组 |
| GET/POST/PATCH | `/api/v1/admin/invitation-groups` | 受邀管理员 | 查询、创建或轮换/停用邀请码组 |
| POST | `/api/v1/admin/invitation-groups/:groupId/mini-code` | 受邀管理员 | 使用请求中提供的邀请码生成微信官方小程序码 PNG |

`courseKey` 是 `课程代码:规范化课程名`，不是前端数组索引。`teacherId` 是数据库中稳定的教师目录 ID（`directory:` 加来源条目 SHA-256），不是姓名；名称可能重名且不具备稳定性。批量摘要的 `ids` 可省略（返回全部），最多 100 个，必须是互不重复的稳定 ID；其响应不包含姓名、学号、昵称、评论、导师资格或来源链接。

`GET /profile` 仅在当前会话持有者范围内返回 `privateBinding.name`、`privateBinding.studentNumber`，用于个人只读显示；其他公开接口、评论和反馈响应永不包含这些字段。

## 数据与隐私

- 课程仅由 `miniprogram/data/course-library.js` 的课程定义导入。
- 教师仅由 `work/teacher-directory/teacher-directory.json` 的目录条目导入。它们是独立互动目标，后端没有课程与教师的关联表，不会把目录条目推断为本科任课事实。
- 数据库以 `(user_id, course_id)` 和 `(user_id, teacher_id)` 主键保证每个账号对相同目标只能点赞一次；支持幂等取消点赞。重复点赞返回稳定的 `liked: true`、`alreadyLiked: true` 与不重复的点赞数。
- 两类评论均在插入前验证点赞，课程与教师评论均限制为 1 至 300 个字符；评论响应永不包含用户、账号、姓名或学号，只以 `anonymous: true` 标识匿名状态。
- HTTP 日志不序列化请求头或请求体，因此不记录 token、姓名、学号或评论原文。
- `POST /api/v1/auth/wechat` 的请求体包含一次性 `code` 和可选 `inviteCode`。客户端不得提交 OpenID、用户 ID、账号标识或个人资料作为身份依据。
- `POST /api/v1/auth/test-identity` 仅接受姓名和 12 位数字学号；它是内部体验入口，不是学校统一身份认证。服务端仅在显式开关开启时提供该路由；同一学号的姓名不一致会返回 `TEST_IDENTITY_MISMATCH`，不覆盖原资料。
- 测试身份的内部账号键为 `test-identity:` 加学号 SHA-256 摘要；明文学号不复制到 `users.account_id`，但首次进入时会作为用户私有绑定资料保存。
- 服务端仅使用微信校验结果建立内部账号键：`wechat:` 加 OpenID 的 SHA-256 摘要。原始 OpenID 不写入 `users.account_id`，只在本次服务端处理期间使用。
- 会话表仅保存随机会话凭据的 SHA-256 哈希，不保存明文会话凭据。凭据不会写入日志、文档或测试快照。
- 微信登录所需敏感配置仅来自云托管安全环境变量，不写入前端、仓库、镜像或日志。
- SQLite 体验版中的会话、点赞、评论和资料变更数据受单个容器生命周期限制；容器重建或扩缩容后不保证保留，不能替代正式 MySQL。
- 当前小程序尚未接入资料修改申请入口，也不提供管理员个人联系方式。后端保留 Bearer 鉴权的 `POST /api/v1/profile/change-requests` 路由，仅记录待处理申请；当前没有管理员处理 API、审核界面或完成通知闭环。
- 邀请组只保存邀请码哈希、末四位提示和成员关系，不保存可从查询接口回显的邀请码明文。停用邀请码组只阻止新成员加入，既有成员保留使用权限。
- MySQL 生产 schema 包含管理员、审计与邀请组表；首个主管理员只能通过受控的初始管理员邀请码或既有初始化账号创建。真实 MySQL 迁移与云端权限仍未实测。

## 数据库运行安全

本地开发与测试使用 SQLite。生产环境要求 `NODE_ENV=production` 与 `DB_DRIVER=mysql`；应用不会自动执行 MySQL migration 或 seed。MySQL migration、seed 均需显式命令以及 `MYSQL_EXECUTE=1`，未满足开关时会在任何数据库连接前拒绝执行。`ENABLE_TEST_IDENTITY_LOGIN=1` 只开启体验版姓名学号测试身份，不代表生产认证能力；邀请制生产启动还需在安全环境变量中配置微信凭据及一次性使用后的初始管理员邀请码。
