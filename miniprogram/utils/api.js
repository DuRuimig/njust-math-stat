var DEFAULT_BASE_URL = "http://127.0.0.1:2001"
var API_MODE_LOCAL = "local"
var API_MODE_CLOUD = "cloud"
var API_PREFIX = "/api/v1"
var DEV_SESSION_PATH = API_PREFIX + "/dev/sessions"
var TEST_IDENTITY_PATH = API_PREFIX + "/auth/test-identity"
var PROFILE_BINDING_PATH = API_PREFIX + "/profile/binding"
var REQUEST_TIMEOUT = 8000
var TEACHER_SUMMARY_BATCH_SIZE = 20
var SESSION_STORAGE_KEY = "njust_math_stat_session"
var sessionStorageBlocked = false
var sessionRevision = 0

function appConfig() {
  var app = typeof getApp === "function" ? getApp() : null
  return (app && app.globalData) || {}
}

function apiMode() {
  // 仅接受明确的 cloud 值；任何缺省或非法值均安全地保持本地模式。
  return appConfig().apiMode === API_MODE_CLOUD ? API_MODE_CLOUD : API_MODE_LOCAL
}

function baseUrl() {
  return appConfig().apiBaseUrl || DEFAULT_BASE_URL
}

function cloudConfig() {
  var config = appConfig()
  return {
    environmentId: config.cloudEnvironmentId || "",
    service: config.cloudContainerService || ""
  }
}

function apiError(message, code) {
  var error = new Error(message)
  error.code = code || "API_UNAVAILABLE"
  return error
}

function cleanText(value, maxLength) {
  var text = String(value === undefined || value === null ? "" : value).trim()
  return text && text.length <= maxLength ? text : ""
}

function readStoredSession() {
  try { return wx.getStorageSync(SESSION_STORAGE_KEY) || null } catch (_error) { return null }
}

function session() {
  if (sessionStorageBlocked) return null
  var current = readStoredSession()
  if (!current || typeof current.token !== "string" || !current.token) return null
  if (typeof current.expiresAt === "number" && current.expiresAt <= Date.now()) {
    clearSession()
    return null
  }
  return current
}

function hasSession() {
  var current = session()
  return Boolean(current && current.token)
}

function sessionMode() {
  var current = session()
  return current && current.mode ? current.mode : ""
}

function clearSession() {
  sessionStorageBlocked = true
  try {
    wx.removeStorageSync(SESSION_STORAGE_KEY)
    sessionRevision += 1
    return true
  } catch (_error) { return false }
}

function clearSessionForToken(expectedToken) {
  if (sessionStorageBlocked) return { cleared: false, superseded: false }
  var current = readStoredSession()
  if (!expectedToken || !current || current.token !== expectedToken) {
    return {
      cleared: false,
      superseded: Boolean(current && (!expectedToken || current.token !== expectedToken))
    }
  }
  return { cleared: clearSession(), superseded: false }
}

function changedSessionError(options, requestSession) {
  if (options.auth === false) return null
  var current = session()
  var requestToken = requestSession && requestSession.token ? requestSession.token : ""
  var currentToken = current && current.token ? current.token : ""
  if (requestToken === currentToken) return null
  var superseded = Boolean(currentToken)
  var error = apiError(
    superseded ? "登录状态已更新，正在刷新" : "登录已失效，请重新登录",
    superseded ? "SESSION_SUPERSEDED" : "SESSION_INVALID"
  )
  error.sessionInvalid = true
  error.sessionCleared = false
  error.sessionSuperseded = superseded
  return error
}

function persistSession(payload) {
  var record = {
    token: payload.token,
    mode: payload.mode,
    expiresAt: Date.now() + payload.expiresInSeconds * 1000
  }
  try {
    wx.setStorageSync(SESSION_STORAGE_KEY, record)
  } catch (_error) {
    clearSession()
    throw apiError("无法保存登录会话，请重试", "SESSION_STORAGE_UNAVAILABLE")
  }
  var persisted
  try {
    persisted = wx.getStorageSync(SESSION_STORAGE_KEY) || null
  } catch (_error) {
    clearSession()
    throw apiError("无法保存登录会话，请重试", "SESSION_STORAGE_UNAVAILABLE")
  }
  if (!persisted || persisted.token !== record.token || persisted.mode !== record.mode || persisted.expiresAt !== record.expiresAt) {
    clearSession()
    throw apiError("无法保存登录会话，请重试", "SESSION_STORAGE_UNAVAILABLE")
  }
  sessionStorageBlocked = false
  sessionRevision += 1
  return payload
}

function getSessionRevision() {
  return sessionRevision
}

function requestHeaders(options, requestSession) {
  var headers = { "content-type": "application/json" }
  var suppliedHeaders = options.header || {}
  Object.keys(suppliedHeaders).forEach(function (key) { headers[key] = suppliedHeaders[key] })
  if (options.auth !== false && requestSession && requestSession.token) headers.Authorization = "Bearer " + requestSession.token
  return headers
}

function resolveResponse(response, resolve, reject) {
  var data = response.data || {}
  if (response.statusCode >= 200 && response.statusCode < 300) return resolve(data)
  var serverCode = data.error && data.error.code
  var sessionInvalid = response.statusCode === 401 && (serverCode === "SESSION_INVALID" || serverCode === "AUTH_REQUIRED")
  var code = response.statusCode === 409 ? "BINDING_CONFLICT" : serverCode || "HTTP_" + response.statusCode
  var error = apiError((data.error && data.error.message) || data.error || "服务暂不可用", code)
  if (sessionInvalid) error.sessionInvalid = true
  reject(error)
}

function requestLocal(options, requestSession) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: baseUrl() + options.path,
      method: options.method || "GET",
      data: options.data || {},
      timeout: REQUEST_TIMEOUT,
      header: requestHeaders(options, requestSession),
      success: function (response) { resolveResponse(response, resolve, reject) },
      fail: function () { reject(apiError("服务未连接，请检查本地开发配置", "NETWORK_ERROR")) }
    })
  })
}

function requestCloud(options, requestSession) {
  return new Promise(function (resolve, reject) {
    var cloud = typeof wx !== "undefined" && wx.cloud
    var config = cloudConfig()
    if (!cloud || typeof cloud.callContainer !== "function") {
      reject(apiError("当前运行环境不支持云托管调用，请使用支持云能力的微信基础库", "CLOUD_CAPABILITY_UNAVAILABLE"))
      return
    }
    if (!config.environmentId || !config.service) {
      reject(apiError("云托管环境或服务名未配置", "CLOUD_CONFIG_INVALID"))
      return
    }

    var method = (options.method || "GET").toUpperCase()
    // 微信公开类型将 method 定义为 string，未枚举或排除 DELETE；按原方法透传。
    // 因而取消点赞仍是 DELETE，绝不降级为 POST 以避免语义变化。
    cloud.callContainer({
      config: { env: config.environmentId },
      service: config.service,
      path: options.path,
      method: method,
      data: options.data || {},
      header: requestHeaders(options, requestSession),
      timeout: REQUEST_TIMEOUT,
      success: function (response) { resolveResponse(response, resolve, reject) },
      fail: function () { reject(apiError("云托管服务未连接，请检查云环境、服务名和发布配置", "NETWORK_ERROR")) }
    })
  })
}

function request(options) {
  var requestSession = options.auth === false ? null : session()
  var pending = apiMode() === API_MODE_CLOUD ? requestCloud(options, requestSession) : requestLocal(options, requestSession)
  return pending.then(function (payload) {
    var changedError = changedSessionError(options, requestSession)
    return changedError ? Promise.reject(changedError) : payload
  }).catch(function (error) {
    if (error && error.sessionInvalid && typeof error.sessionSuperseded === "boolean") return Promise.reject(error)
    var changedError = changedSessionError(options, requestSession)
    if (changedError) {
      if (error && error.sessionInvalid) {
        error.sessionCleared = false
        error.sessionSuperseded = true
        return Promise.reject(error)
      }
      return Promise.reject(changedError)
    }
    if (error && error.sessionInvalid) {
      var invalidation = clearSessionForToken(requestSession && requestSession.token)
      error.sessionCleared = invalidation.cleared
      error.sessionSuperseded = invalidation.superseded
    }
    return Promise.reject(error)
  })
}

function deferSessionPersistence(options) {
  return Boolean(options && options.deferPersist === true)
}

function loginWithWechat(options) {
  if (typeof wx === "undefined" || typeof wx.login !== "function") {
    return Promise.reject(apiError("当前运行环境不支持微信登录", "WECHAT_LOGIN_UNAVAILABLE"))
  }
  return new Promise(function (resolve, reject) {
    wx.login({
      timeout: REQUEST_TIMEOUT,
      success: function (result) {
        if (!result || !result.code) return reject(apiError("未获得微信登录凭据，请重试", "WECHAT_LOGIN_UNAVAILABLE"))
        resolve(result.code)
      },
      fail: function () { reject(apiError("微信登录未完成，请重试", "WECHAT_LOGIN_UNAVAILABLE")) }
    })
  }).then(function (code) {
    return request({ method: "POST", path: API_PREFIX + "/auth/wechat", auth: false, data: { code: code } })
  }).then(function (payload) {
    if (!payload || typeof payload.token !== "string" || payload.mode !== "wechat" || !Number.isInteger(payload.expiresInSeconds) || payload.expiresInSeconds < 1) {
      throw apiError("微信登录响应无效", "INVALID_SESSION_RESPONSE")
    }
    return deferSessionPersistence(options) ? payload : persistSession(payload)
  })
}

function createDevelopmentSession(options) {
  var accountId = "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10)
  return request({ method: "POST", path: DEV_SESSION_PATH, auth: false, data: { accountId: accountId } }).then(function (payload) {
    if (!payload.token || payload.mode !== "development-test-only" || !Number.isInteger(payload.expiresInSeconds) || payload.expiresInSeconds < 1) {
      throw apiError("开发测试会话创建失败", "INVALID_SESSION_RESPONSE")
    }
    return deferSessionPersistence(options) ? payload : persistSession(payload)
  })
}

function loginWithTestIdentity(identity, options) {
  var name = cleanText(identity && identity.name, 80)
  var studentNumber = cleanText(identity && identity.studentNumber, 12)
  if (!name || !/^\d{12}$/.test(studentNumber)) {
    return Promise.reject(apiError("请填写姓名和 12 位学号", "INVALID_TEST_IDENTITY"))
  }
  return request({ method: "POST", path: TEST_IDENTITY_PATH, auth: false, data: { name: name, studentNumber: studentNumber } }).then(function (payload) {
    if (!payload || typeof payload.token !== "string" || payload.mode !== "test-identity" || !Number.isInteger(payload.expiresInSeconds) || payload.expiresInSeconds < 1) {
      throw apiError("测试身份响应无效", "INVALID_SESSION_RESPONSE")
    }
    return deferSessionPersistence(options) ? payload : persistSession(payload)
  })
}

function normalizeProfile(payload) {
  var profile = payload.profile || payload
  return {
    userId: payload.userId || profile.userId || "",
    nickname: profile.nickname || "",
    avatarUrl: profile.avatarUrl || "",
    privateBinding: payload.privateBinding || profile.privateBinding || null,
    bindingStatus: payload.bindingStatus || profile.bindingStatus || "real-login-pending",
    isAdmin: Boolean(payload.isAdmin || profile.isAdmin),
    isPrimaryAdmin: Boolean(payload.isPrimaryAdmin || profile.isPrimaryAdmin)
  }
}

function getProfile() {
  return request({ path: API_PREFIX + "/profile" }).then(normalizeProfile)
}

function updateProfile(profile) {
  var nickname = cleanText(profile && profile.nickname, 24)
  if (!nickname) return Promise.reject(apiError("请填写昵称", "INVALID_PROFILE"))
  return request({ method: "PATCH", path: API_PREFIX + "/profile", data: { nickname: nickname } }).then(normalizeProfile)
}

function bindProfile(binding) {
  var name = cleanText(binding && binding.name, 80)
  var studentNumber = cleanText(binding && binding.studentNumber, 32)
  if (!name || !studentNumber) return Promise.reject(apiError("请完整填写姓名和学号", "INVALID_BINDING"))
  return request({ method: "POST", path: PROFILE_BINDING_PATH, data: { name: name, studentNumber: studentNumber } }).then(normalizeProfile)
}

function requestProfileChange(change) {
  var name = cleanText(change && change.name, 80)
  var studentNumber = cleanText(change && change.studentNumber, 32)
  if (!name && !studentNumber) return Promise.reject(apiError("请填写姓名或学号", "INVALID_CHANGE_REQUEST"))
  return request({ method: "POST", path: API_PREFIX + "/profile/change-requests", data: { name: name || undefined, studentNumber: studentNumber || undefined } })
}

function targetPath(kind, id) {
  if (kind !== "courses" && kind !== "teachers") throw apiError("互动类型无效", "INVALID_TARGET")
  var safeId = cleanText(id, 256)
  if (!safeId) throw apiError("互动对象标识无效", "INVALID_TARGET")
  return API_PREFIX + "/" + kind + "/" + encodeURIComponent(safeId)
}

function getFeedback(kind, id) {
  return request({ path: targetPath(kind, id) + "/feedback" })
}

function requestTeacherFeedbackSummary(teacherIds) {
  var query = teacherIds.length ? "?ids=" + encodeURIComponent(teacherIds.join(",")) : ""
  return request({ path: API_PREFIX + "/teachers/feedback-summary" + query })
}

function mergeTeacherFeedbackSummaries(teacherIds, responses) {
  var byId = {}
  responses.forEach(function (response) {
    var items = response && Array.isArray(response.items) ? response.items : []
    items.forEach(function (item) {
      if (item && teacherIds.indexOf(item.teacherId) >= 0) byId[item.teacherId] = item
    })
  })
  return {
    items: teacherIds.map(function (teacherId) {
      return byId[teacherId] || { teacherId: teacherId, likeCount: 0, likedByMe: false }
    })
  }
}

function getTeacherFeedbackSummary(ids) {
  var teacherIds = Array.isArray(ids) ? ids.map(String) : []
  var uniqueIds = {}
  if (teacherIds.length > 100 || teacherIds.some(function (id) {
    if (!/^directory:[a-f0-9]{64}$/.test(id) || uniqueIds[id]) return true
    uniqueIds[id] = true
    return false
  })) {
    return Promise.reject(apiError("教师目录标识无效", "INVALID_TARGET"))
  }
  if (!teacherIds.length) return requestTeacherFeedbackSummary(teacherIds)
  if (teacherIds.length <= TEACHER_SUMMARY_BATCH_SIZE) {
    return requestTeacherFeedbackSummary(teacherIds).then(function (response) {
      return mergeTeacherFeedbackSummaries(teacherIds, [response])
    })
  }

  var batches = []
  for (var index = 0; index < teacherIds.length; index += TEACHER_SUMMARY_BATCH_SIZE) {
    batches.push(teacherIds.slice(index, index + TEACHER_SUMMARY_BATCH_SIZE))
  }
  return Promise.all(batches.map(requestTeacherFeedbackSummary)).then(function (responses) {
    return mergeTeacherFeedbackSummaries(teacherIds, responses)
  })
}

function like(kind, id) {
  return request({ method: "POST", path: targetPath(kind, id) + "/likes" })
}

function unlike(kind, id) {
  return request({ method: "DELETE", path: targetPath(kind, id) + "/likes" })
}

function postComment(kind, id, content) {
  var text = cleanText(content, 300)
  if (!text) return Promise.reject(apiError("评论需为 1 至 300 个字符", "INVALID_COMMENT"))
  return request({ method: "POST", path: targetPath(kind, id) + "/comments", data: { content: text } })
}

function deleteComment(kind, id, commentId) {
  var safeCommentId = cleanText(commentId, 36)
  if (!/^[0-9a-f-]{36}$/i.test(safeCommentId)) return Promise.reject(apiError("评论标识无效", "INVALID_COMMENT"))
  return request({ method: "DELETE", path: targetPath(kind, id) + "/comments/" + encodeURIComponent(safeCommentId) })
}

function searchAdminUsers(query) {
  var text = cleanText(query, 80)
  if (!text) return Promise.reject(apiError("请输入姓名或学号", "INVALID_ADMIN_QUERY"))
  return request({ path: API_PREFIX + "/admin/users?q=" + encodeURIComponent(text) })
}

function updateAdminUserIdentity(userId, identity) {
  var safeUserId = cleanText(userId, 36)
  var name = cleanText(identity && identity.name, 80)
  var studentNumber = cleanText(identity && identity.studentNumber, 12)
  if (!/^[0-9a-f-]{36}$/i.test(safeUserId) || !name || !/^\d{12}$/.test(studentNumber)) {
    return Promise.reject(apiError("姓名和 12 位学号格式无效", "INVALID_ADMIN_IDENTITY"))
  }
  return request({ method: "PATCH", path: API_PREFIX + "/admin/users/" + encodeURIComponent(safeUserId) + "/identity", data: { name: name, studentNumber: studentNumber } })
}

function updateAdminUserStatus(userId, banned) {
  var safeUserId = cleanText(userId, 36)
  if (!/^[0-9a-f-]{36}$/i.test(safeUserId) || typeof banned !== "boolean") {
    return Promise.reject(apiError("账号状态无效", "INVALID_ADMIN_ACCOUNT_STATUS"))
  }
  return request({ method: "PATCH", path: API_PREFIX + "/admin/users/" + encodeURIComponent(safeUserId) + "/account-status", data: { banned: banned } })
}

function deleteAdminUser(userId) {
  var safeUserId = cleanText(userId, 36)
  if (!/^[0-9a-f-]{36}$/i.test(safeUserId)) {
    return Promise.reject(apiError("账号标识无效", "INVALID_ADMIN_USER"))
  }
  return request({ method: "DELETE", path: API_PREFIX + "/admin/users/" + encodeURIComponent(safeUserId) })
}

function updateAdminUserRole(userId, isAdmin) {
  var safeUserId = cleanText(userId, 36)
  if (!/^[0-9a-f-]{36}$/i.test(safeUserId) || typeof isAdmin !== "boolean") {
    return Promise.reject(apiError("管理员权限无效", "INVALID_ADMIN_ROLE"))
  }
  return request({ method: "PATCH", path: API_PREFIX + "/admin/users/" + encodeURIComponent(safeUserId) + "/admin-role", data: { isAdmin: isAdmin } })
}

function transferPrimaryAdmin(userId) {
  var safeUserId = cleanText(userId, 36)
  if (!/^[0-9a-f-]{36}$/i.test(safeUserId)) {
    return Promise.reject(apiError("主管理员目标无效", "INVALID_PRIMARY_ADMIN"))
  }
  return request({ method: "PATCH", path: API_PREFIX + "/admin/users/" + encodeURIComponent(safeUserId) + "/primary-admin" })
}

module.exports = {
  DEFAULT_BASE_URL: DEFAULT_BASE_URL,
  API_MODE_LOCAL: API_MODE_LOCAL,
  API_MODE_CLOUD: API_MODE_CLOUD,
  API_PREFIX: API_PREFIX,
  DEV_SESSION_PATH: DEV_SESSION_PATH,
  TEST_IDENTITY_PATH: TEST_IDENTITY_PATH,
  PROFILE_BINDING_PATH: PROFILE_BINDING_PATH,
  hasSession: hasSession,
  sessionMode: sessionMode,
  getSessionRevision: getSessionRevision,
  clearSession: clearSession,
  persistSession: persistSession,
  loginWithWechat: loginWithWechat,
  loginWithTestIdentity: loginWithTestIdentity,
  createDevelopmentSession: createDevelopmentSession,
  getProfile: getProfile,
  updateProfile: updateProfile,
  bindProfile: bindProfile,
  requestProfileChange: requestProfileChange,
  getTeacherFeedbackSummary: getTeacherFeedbackSummary,
  getFeedback: getFeedback,
  like: like,
  unlike: unlike,
  postComment: postComment,
  deleteComment: deleteComment,
  searchAdminUsers: searchAdminUsers,
  updateAdminUserIdentity: updateAdminUserIdentity,
  updateAdminUserStatus: updateAdminUserStatus,
  deleteAdminUser: deleteAdminUser,
  updateAdminUserRole: updateAdminUserRole,
  transferPrimaryAdmin: transferPrimaryAdmin
}
