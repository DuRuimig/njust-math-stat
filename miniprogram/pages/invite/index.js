var api = require("../../utils/api")

function clean(value) { return String(value === undefined || value === null ? "" : value).trim() }
function decode(value) {
  var result = clean(value)
  try { return decodeURIComponent(result) } catch (_error) { return result }
}
function sceneInviteCode(scene) {
  var value = decode(scene)
  if (!value) return ""
  var match = value.match(/(?:^|[?&])(?:inviteCode|code)=([^&]+)/i)
  return decode(match ? match[1] : value)
}

Page({
  data: { inviteCode: "", inviteCodeFromScene: false, target: "/pages/profile/index", isLoggingIn: false, errorMessage: "" },
  onLoad: function (options) {
    options = options || {}
    var sceneCode = sceneInviteCode(options.scene)
    this.setData({ inviteCode: sceneCode || decode(options.inviteCode || options.code), inviteCodeFromScene: Boolean(sceneCode), target: decode(options.target) || "/pages/profile/index" })
  },
  onInviteCodeInput: function (event) { this.setData({ inviteCode: clean(event.detail && event.detail.value).slice(0, 20), errorMessage: "" }) },
  login: function () {
    if (this.data.isLoggingIn) return
    var inviteCode = clean(this.data.inviteCode)
    if (!inviteCode) { this.setData({ errorMessage: "请输入邀请码" }); return }
    var page = this
    this.setData({ isLoggingIn: true, errorMessage: "" })
    api.loginWithWechat({ inviteCode: inviteCode, deferPersist: true }).then(function (payload) {
      api.persistSession(payload)
      wx.showToast({ title: "加入成功", icon: "success" })
      setTimeout(function () { page.finish() }, 450)
    }).catch(function (error) { page.setData({ isLoggingIn: false, errorMessage: (error && error.message) || "邀请码无效或服务暂不可用" }) })
  },
  finish: function () {
    var target = this.data.target || "/pages/profile/index"
    var url = target.charAt(0) === "/" ? target : "/" + target
    if (/^\/?pages\/(catalog|teaching|profile)\/index(?:\?|$)/.test(target)) { wx.switchTab({ url: url }); return }
    wx.redirectTo({ url: url })
  },
  goBack: function () {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: "/pages/catalog/index" })
  }
})
