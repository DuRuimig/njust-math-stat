var DEFAULT_BASE_URL = "http://127.0.0.1:2001"
var API_PREFIX = "/api/v1"
var DEV_SESSION_PATH = API_PREFIX + "/dev/sessions"
var PROFILE_BINDING_PATH = API_PREFIX + "/profile/binding"
var REQUEST_TIMEOUT = 8000
var SESSION_STORAGE_KEY = "njust_math_stat_development_session"

function baseUrl() {
  var app = typeof getApp === "function" ? getApp() : null
  return (app && app.globalData && app.globalData.apiBaseUrl) || DEFAULT_BASE_URL
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

function session() {
  try { return wx.getStorageSync(SESSION_STORAGE_KEY) || null } catch (_error) { return null }
}

function hasSession() {
  var current = session()
  return Boolean(current && current.token)
}

function request(options) {
  return new Promise(function (resolve, reject) {
    var headers = { "content-type": "application/json" }
    var current = session()
    if (options.auth !== false && current && current.token) headers.Authorization = "Bearer " + current.token
    wx.request({
      url: baseUrl() + options.path,
      method: options.method || "GET",
      data: options.data || {},
      timeout: REQUEST_TIMEOUT,
      header: headers,
      success: function (response) {
        var data = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(data)
        var code = response.statusCode === 401 ? "NO_SESSION" : response.statusCode === 409 ? "BINDING_CONFLICT" : "HTTP_" + response.statusCode
        reject(apiError((data.error && data.error.message) || data.error || "服务暂不可用", code))
      },
      fail: function () { reject(apiError("服务未连接，请检查本地开发配置", "NETWORK_ERROR")) }
    })
  })
}

function createDevelopmentSession() {
  var accountId = "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10)
  return request({ method: "POST", path: DEV_SESSION_PATH, auth: false, data: { accountId: accountId } }).then(function (payload) {
    if (!payload.token || payload.mode !== "development-test-only") throw apiError("开发测试会话创建失败", "INVALID_SESSION_RESPONSE")
    try { wx.setStorageSync(SESSION_STORAGE_KEY, { token: payload.token, mode: payload.mode }) } catch (_error) {}
    return payload
  })
}

function normalizeProfile(payload) {
  var profile = payload.profile || payload
  return {
    nickname: profile.nickname || "",
    avatarUrl: profile.avatarUrl || "",
    privateBinding: payload.privateBinding || profile.privateBinding || null,
    bindingStatus: payload.bindingStatus || profile.bindingStatus || "real-login-pending"
  }
}

function getProfile() {
  return request({ path: API_PREFIX + "/profile" }).then(normalizeProfile)
}

function updateProfile(profile) {
  var nickname = cleanText(profile && profile.nickname, 24)
  var avatarUrl = cleanText(profile && profile.avatarUrl, 512)
  if (!nickname && !avatarUrl) return Promise.reject(apiError("请填写昵称或选择头像", "INVALID_PROFILE"))
  return request({ method: "PATCH", path: API_PREFIX + "/profile", data: { nickname: nickname || undefined, avatarUrl: avatarUrl || null } }).then(normalizeProfile)
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

function getTeacherFeedbackSummary(ids) {
  var teacherIds = Array.isArray(ids) ? ids : []
  if (teacherIds.length > 100 || teacherIds.some(function (id) { return !/^directory:[a-f0-9]{64}$/.test(String(id || "")) })) {
    return Promise.reject(apiError("教师目录标识无效", "INVALID_TARGET"))
  }
  var query = teacherIds.length ? "?ids=" + encodeURIComponent(teacherIds.join(",")) : ""
  return request({ path: API_PREFIX + "/teachers/feedback-summary" + query })
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

module.exports = {
  DEFAULT_BASE_URL: DEFAULT_BASE_URL,
  API_PREFIX: API_PREFIX,
  DEV_SESSION_PATH: DEV_SESSION_PATH,
  PROFILE_BINDING_PATH: PROFILE_BINDING_PATH,
  hasSession: hasSession,
  createDevelopmentSession: createDevelopmentSession,
  getProfile: getProfile,
  updateProfile: updateProfile,
  bindProfile: bindProfile,
  requestProfileChange: requestProfileChange,
  getTeacherFeedbackSummary: getTeacherFeedbackSummary,
  getFeedback: getFeedback,
  like: like,
  unlike: unlike,
  postComment: postComment
}
