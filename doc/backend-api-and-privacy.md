# 后端 API 与隐私边界

## 主契约

主 API 前缀为 `/api/v1`。历史 `/api` 路径只作为兼容别名，不应新增调用。所有错误响应使用 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/health` | 否 | 服务健康检查 |
| POST | `/api/v1/auth/wechat` | 否 | 固定返回 `503`，真实微信登录未配置 |
| POST | `/api/v1/dev/sessions` | 否，仅非生产 | 创建未绑定的本地开发测试会话 |
| GET/PATCH | `/api/v1/profile` | Bearer | 读取本人资料；仅更新昵称、头像 URL |
| POST | `/api/v1/profile/binding` | Bearer | 完成首次姓名、学号绑定 |
| POST | `/api/v1/profile/change-requests` | Bearer | 提交姓名或学号修改申请 |
| GET | `/api/v1/courses/:courseKey/feedback` | 可选 Bearer | 返回 `likeCount`、`likedByMe` 和匿名评论 |
| POST | `/api/v1/courses/:courseKey/likes` | Bearer | 课程点赞，重复请求返回已点赞状态 |
| POST | `/api/v1/courses/:courseKey/comments` | Bearer | 已点赞后匿名评论，字段为 `content` |
| GET | `/api/v1/teachers/feedback-summary?ids=:teacherId,...` | 可选 Bearer | 批量返回教师 `teacherId`、`likeCount`；有会话时附 `likedByMe` |
| POST | `/api/v1/teachers/:teacherId/likes` | Bearer | 教师一次点赞，重复请求返回已点赞状态 |

`courseKey` 是 `课程代码:规范化课程名`，不是前端数组索引。`teacherId` 是数据库中稳定的教师目录 ID（`directory:` 加来源条目 SHA-256），不是姓名；名称可能重名且不具备稳定性。批量摘要的 `ids` 可省略（返回全部），最多 100 个，必须是互不重复的稳定 ID；其响应不包含姓名、学号、昵称、评论、导师资格或来源链接。

`GET /profile` 仅在当前会话持有者范围内返回 `privateBinding.name`、`privateBinding.studentNumber`，用于个人只读显示；其他公开接口、评论和反馈响应永不包含这些字段。

## 数据与隐私

- 课程仅由 `miniprogram/data/course-library.js` 的课程定义导入。
- 教师仅由 `work/teacher-directory/teacher-directory.json` 的目录条目导入。它们是独立互动目标，后端没有课程与教师的关联表，不会把目录条目推断为本科任课事实。
- 数据库以 `(user_id, course_id)` 和 `(user_id, teacher_id)` 主键保证每个账号对相同目标只能点赞一次；不支持取消点赞。重复请求返回稳定的 `liked: true`、`alreadyLiked: true` 与不重复的点赞数。
- 两类评论均在插入前验证点赞；评论响应永不包含用户、账号、姓名或学号，只以 `anonymous: true` 标识匿名状态。
- HTTP 日志不序列化请求头或请求体，因此不记录 token、姓名、学号或评论原文。
- 当前版本不提供管理员个人联系方式；身份资料修改入口待接入，后端没有相关的联系或认证 API。
