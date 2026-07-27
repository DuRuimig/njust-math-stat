# 小程序云托管调用切换说明

## 当前状态

本项目仅加入小程序客户端的云托管调用准备，未部署或修改任何云资源，也未连接 MySQL。以下公开标识仅用于请求路由：

- 云环境 ID：`prod-d5gfes93j0a83438c`
- 云托管服务名：`express-4id4`

代码中没有密钥、数据库账号密码或用户个人数据。

## 本地开发（需手动切换）

本地开发可将 `miniprogram/app.js` 的 `globalData.apiMode` 手动设置为 `local`。此时 `utils/api.js` 使用 `wx.request` 请求 `apiBaseUrl`，默认是 `http://127.0.0.1:2001`。

## 切换到云托管

当前体验版已经在 `miniprogram/app.js` 中显式设置：

```js
apiMode: "cloud"
```

该值必须显式设置为 `cloud` 才会调用云托管；空值、`local` 或其他值都会继续使用本地 HTTP，避免开发者工具或未知环境意外访问生产服务。云模式下，客户端会调用：

- `wx.cloud.init({ env })`：启动时尝试初始化；缺少云能力或初始化抛错时不会阻止小程序启动。
- `wx.cloud.callContainer({ config: { env }, service })`：按原始 `path`、`method`、`data` 调用容器服务。
- `Authorization: Bearer <token>`：存在真实微信会话时照常转发。

云模式不会构造或使用 `127.0.0.1` URL。

## 方法与错误兼容

请求响应沿用本地 HTTP 的成功区间（2xx），并优先保留服务端错误码。服务端返回 401 且错误码为 `SESSION_INVALID` 或 `AUTH_REQUIRED` 时，客户端会标记该请求的会话失效；只有当本地当前 token 仍与该请求实际携带的 token 一致时才尝试清理。请求结束时还会再次核对会话快照：旧会话或匿名请求被新会话取代后，其迟到成功、401、网络错误和其他失败都会作废，相关页面使用当前会话重新加载，不会删除或退出新会话。即使同一会话的本地存储清理失败，相关页面仍会退出登录态并禁用身份写操作。其他 401 不会被固定改写为会话失效；409 映射为 `BINDING_CONFLICT`，没有服务端错误码的其他状态使用 `HTTP_<status>`。当前会话上的网络或云调用失败映射为 `NETWORK_ERROR`，不会清除登录态。

微信小程序公开类型将 `wx.cloud.callContainer` 的 `method` 声明为 `string`，没有把 `DELETE` 排除或限制为固定枚举。因此客户端按原方法透传，取消点赞仍以 `DELETE /api/v1/:kind/:id/likes` 发起，不会用 POST 伪造 DELETE。若目标基础库或运行环境无法使用 `callContainer`，客户端会明确返回 `CLOUD_CAPABILITY_UNAVAILABLE`；若服务端拒绝 DELETE，则按原有 HTTP 状态映射报错，不会静默回退到本地或改变取消点赞语义。

## 发布前待验证项

尚未对真实云环境、云托管服务或网络进行调用验证。发布前需在目标微信基础库和已授权环境中验证：

1. `wx.cloud.init` 与 `wx.cloud.callContainer` 可用，且环境 ID、服务名路由正确；
2. GET、POST、PATCH 现有接口的容器转发策略（如服务端不接受 PATCH，需先更新服务端契约，不能在客户端静默改写）；
3. `DELETE` 取消点赞响应与前端状态更新；
4. `wx.login` 成功后的 `code` 可经容器转发到服务端，服务端在配置了安全环境变量后成功创建会话；
5. Bearer 鉴权头在容器转发后的服务端可用；
6. 2xx、401、409、其他错误和断网场景的用户提示。

## 体验版运行边界

根目录 `Dockerfile` 以仓库根目录为构建上下文，使用 `8080` 端口，并在构建阶段通过 SQLite 迁移和公共课程种子数据生成无个人数据的数据库。云托管控制台保持根目录作为目标目录，Dockerfile 名称为 `Dockerfile`，服务端口为 `8080`。

当前体验版使用 `POST /api/v1/auth/test-identity`：输入姓名和 12 位数字学号后建立随机 Bearer 会话。云托管部署时需单独设置 `ENABLE_TEST_IDENTITY_LOGIN=1`，它只表示允许内部测试身份，不能当作学校统一认证。小程序默认 `authMode: "test-identity"`，真实微信登录代码保留但当前不显示入口。SQLite 数据仍仅存在于单个容器运行期，容器重建或扩缩容后不保证保留，不能替代正式 MySQL。

后续微信版使用 `wx.login → POST /api/v1/auth/wechat → 服务端 jscode2session → 随机 Bearer 会话`。届时才需在云托管安全环境变量中配置 `WX_MINIPROGRAM_APP_ID` 和 `WX_MINIPROGRAM_APP_SECRET`，不在代码、前端配置、镜像或日志中保存其值。
