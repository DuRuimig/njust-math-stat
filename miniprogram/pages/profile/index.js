var api = require("../../utils/api")

function serviceMessage(error) {
  return (error && error.message) || "服务未连接，请检查本地开发配置"
}

function loginStatusForMode(mode) {
  if (mode === "test-identity") return "测试身份"
  return mode === "wechat" ? "微信已登录" : "开发测试身份"
}

function signedOutMessage(isTestIdentityMode) {
  return isTestIdentityMode ? "请填写姓名和 12 位学号进入测试身份" : "请使用微信登录后访问身份与互动功能"
}

function shouldShowSessionExpired(error) {
  return !(error && (error.sessionSuperseded || error.code === "SESSION_SUPERSEDED"))
}

Page({
  data: {
    loginStatus: "未登录",
    serviceStatus: "请填写姓名和 12 位学号进入测试身份",
    nickname: "",
    avatarUrl: "",
    bindingStatus: "real-login-pending",
    studentName: "",
    studentId: "",
    hasStudentName: false,
    hasStudentId: false,
    isLoggedIn: false,
    isDevelopmentSession: false,
    isCloudMode: false,
    isTestIdentityMode: false,
    isCreatingSession: false,
    isBindingProfile: false,
    isEditingProfile: false,
    isSavingProfile: false,
    isAdmin: false,
    adminQuery: "",
    adminUsers: [],
    adminEditingUserId: "",
    adminEditingName: "",
    adminEditingStudentNumber: "",
    isSearchingAdminUsers: false,
    isSavingAdminIdentity: false,
    adminStatusChangingUserId: ""
  },

  onShow: function () {
    var app = typeof getApp === "function" ? getApp() : null
    var config = (app && app.globalData) || {}
    this.setData({
      isCloudMode: config.apiMode === api.API_MODE_CLOUD,
      isTestIdentityMode: config.authMode === "test-identity"
    })
    this.loadProfile()
  },

  loadProfile: function () {
    var page = this
    var requestEpoch = this.nextSessionRequestEpoch()
    if (!api.hasSession()) {
      this.setData({
        isLoggedIn: false,
        isDevelopmentSession: false,
        loginStatus: "未登录",
        serviceStatus: signedOutMessage(this.data.isTestIdentityMode),
        nickname: "",
        avatarUrl: "",
        bindingStatus: "real-login-pending",
        studentName: "",
        studentId: "",
        hasStudentName: false,
        hasStudentId: false,
        isCreatingSession: false,
        isBindingProfile: false,
        isEditingProfile: false,
        isSavingProfile: false,
        isAdmin: false,
        adminQuery: "",
        adminUsers: [],
        adminEditingUserId: "",
        adminEditingName: "",
        adminEditingStudentNumber: "",
        isSearchingAdminUsers: false,
        isSavingAdminIdentity: false,
        adminStatusChangingUserId: ""
      })
      return
    }
    this.setData({
      isLoggedIn: true,
      isDevelopmentSession: api.sessionMode() === "development-test-only",
      loginStatus: loginStatusForMode(api.sessionMode()),
      serviceStatus: "正在读取个人资料"
    })
    api.getProfile().then(function (profile) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var binding = profile.privateBinding || {}
      page.setData({
        isLoggedIn: true,
        isDevelopmentSession: api.sessionMode() === "development-test-only",
        loginStatus: loginStatusForMode(api.sessionMode()),
        serviceStatus: page.data.isCloudMode ? "云托管身份服务已连接" : "本地 API 已连接",
        nickname: profile.nickname || "",
        avatarUrl: profile.avatarUrl || "",
        bindingStatus: profile.bindingStatus || "real-login-pending",
        studentName: binding.name || "",
        studentId: binding.studentNumber || "",
        hasStudentName: Boolean(binding.name),
        hasStudentId: Boolean(binding.studentNumber),
        isCreatingSession: false,
        isBindingProfile: false,
        isSavingProfile: false,
        isAdmin: Boolean(profile.isAdmin),
        adminUsers: profile.isAdmin ? page.data.adminUsers : [],
        adminEditingUserId: profile.isAdmin ? page.data.adminEditingUserId : "",
        adminEditingName: profile.isAdmin ? page.data.adminEditingName : "",
        adminEditingStudentNumber: profile.isAdmin ? page.data.adminEditingStudentNumber : "",
        isSearchingAdminUsers: false,
        isSavingAdminIdentity: false,
        adminStatusChangingUserId: ""
      })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) return
      page.setData({
        serviceStatus: "暂时无法读取个人资料，请稍后重试",
        isCreatingSession: false,
        isBindingProfile: false,
        isSavingProfile: false,
        isSearchingAdminUsers: false,
        isSavingAdminIdentity: false,
        adminStatusChangingUserId: ""
      })
    })
  },

  nextSessionRequestEpoch: function () {
    this.sessionRequestEpoch = (this.sessionRequestEpoch || 0) + 1
    return this.sessionRequestEpoch
  },

  isCurrentSessionRequest: function (requestEpoch) {
    return requestEpoch === (this.sessionRequestEpoch || 0)
  },

  showSessionExpired: function (error) {
    if (!error || !error.sessionInvalid) return false
    if (error.sessionSuperseded) {
      this.loadProfile()
      return true
    }
    this.nextSessionRequestEpoch()
    this.setData({
      isLoggedIn: false,
      isDevelopmentSession: false,
      loginStatus: "登录已失效",
      serviceStatus: "登录已失效，请重新登录",
      nickname: "",
      avatarUrl: "",
      bindingStatus: "real-login-pending",
      studentName: "",
      studentId: "",
      hasStudentName: false,
      hasStudentId: false,
      isCreatingSession: false,
      isBindingProfile: false,
      isEditingProfile: false,
      isSavingProfile: false,
      isAdmin: false,
      adminQuery: "",
      adminUsers: [],
      adminEditingUserId: "",
      adminEditingName: "",
      adminEditingStudentNumber: "",
      isSearchingAdminUsers: false,
      isSavingAdminIdentity: false,
      adminStatusChangingUserId: ""
    })
    return true
  },

  startDevelopmentSession: function () {
    if (this.data.isCreatingSession) return
    var page = this
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isCreatingSession: true })
    api.createDevelopmentSession({ deferPersist: true }).then(function (payload) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      api.persistSession(payload)
      page.setData({ isCreatingSession: false })
      page.loadProfile()
      wx.showToast({ title: "已进入开发测试身份", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isCreatingSession: false, serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  loginWithWechat: function () {
    if (this.data.isCreatingSession) return
    var page = this
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isCreatingSession: true })
    api.loginWithWechat({ deferPersist: true }).then(function (payload) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      api.persistSession(payload)
      page.setData({ isCreatingSession: false })
      page.loadProfile()
      wx.showToast({ title: "微信登录成功", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isCreatingSession: false, loginStatus: "登录未完成", serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  loginWithTestIdentity: function () {
    if (this.data.isCreatingSession) return
    var page = this
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isCreatingSession: true })
    api.loginWithTestIdentity({ name: this.data.studentName, studentNumber: this.data.studentId }, { deferPersist: true }).then(function (payload) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      api.persistSession(payload)
      page.setData({ isCreatingSession: false })
      page.loadProfile()
      wx.showToast({ title: "已进入测试身份", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isCreatingSession: false, loginStatus: "进入未完成", serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  toggleProfileEditor: function () {
    this.setData({ isEditingProfile: !this.data.isEditingProfile })
  },

  onNicknameInput: function (event) {
    this.setData({ nickname: String(event.detail.value || "").slice(0, 24) })
  },

  onStudentNameInput: function (event) {
    this.setData({ studentName: String(event.detail.value || "").slice(0, 80) })
  },

  onStudentIdInput: function (event) {
    this.setData({ studentId: String(event.detail.value || "").slice(0, this.data.isTestIdentityMode ? 12 : 32) })
  },

  onAdminQueryInput: function (event) {
    this.setData({ adminQuery: String(event.detail.value || "").slice(0, 80) })
  },

  onAdminNameInput: function (event) {
    this.setData({ adminEditingName: String(event.detail.value || "").slice(0, 80) })
  },

  onAdminStudentNumberInput: function (event) {
    this.setData({ adminEditingStudentNumber: String(event.detail.value || "").slice(0, 12) })
  },

  searchAdminUsers: function () {
    var page = this
    if (!this.data.isAdmin || this.data.isSearchingAdminUsers) return
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isSearchingAdminUsers: true, adminUsers: [], adminEditingUserId: "" })
    api.searchAdminUsers(this.data.adminQuery).then(function (response) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      page.setData({ adminUsers: Array.isArray(response.items) ? response.items : [], isSearchingAdminUsers: false })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) return
      page.setData({ isSearchingAdminUsers: false })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  selectAdminUser: function (event) {
    var userId = event.currentTarget.dataset.id
    var user = this.data.adminUsers.filter(function (item) { return item.id === userId })[0]
    if (!user) return
    this.setData({
      adminEditingUserId: user.id,
      adminEditingName: user.name || "",
      adminEditingStudentNumber: user.studentNumber || ""
    })
  },

  saveAdminIdentity: function () {
    var page = this
    if (!this.data.isAdmin || !this.data.adminEditingUserId || this.data.isSavingAdminIdentity) return
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isSavingAdminIdentity: true })
    api.updateAdminUserIdentity(this.data.adminEditingUserId, {
      name: this.data.adminEditingName,
      studentNumber: this.data.adminEditingStudentNumber
    }).then(function (response) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var user = response.user || {}
      page.setData({
        adminUsers: page.data.adminUsers.map(function (item) {
          return item.id === page.data.adminEditingUserId ? Object.assign({}, item, { name: user.name || item.name, studentNumber: user.studentNumber || item.studentNumber }) : item
        }),
        isSavingAdminIdentity: false
      })
      wx.showToast({ title: "身份资料已更正", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) return
      page.setData({ isSavingAdminIdentity: false })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  toggleAdminUserStatus: function (event) {
    var page = this
    var userId = event.currentTarget.dataset.id
    var currentlyBanned = Boolean(event.currentTarget.dataset.banned)
    if (!this.data.isAdmin || !userId || this.data.adminStatusChangingUserId) return
    wx.showModal({
      title: currentlyBanned ? "解除封禁" : "封禁账号",
      content: currentlyBanned ? "解除后，该用户可使用已绑定的身份重新登录。" : "封禁后，该用户会立即退出，且不能再次登录。",
      success: function (result) {
        if (!result.confirm) return
        var requestEpoch = page.sessionRequestEpoch || 0
        page.setData({ adminStatusChangingUserId: userId })
        api.updateAdminUserStatus(userId, !currentlyBanned).then(function (response) {
          if (!page.isCurrentSessionRequest(requestEpoch)) return
          var user = response.user || {}
          page.setData({
            adminUsers: page.data.adminUsers.map(function (item) {
              return item.id === userId ? Object.assign({}, item, { isBanned: Boolean(user.isBanned) }) : item
            }),
            adminStatusChangingUserId: ""
          })
          wx.showToast({ title: user.isBanned ? "账号已封禁" : "账号已解除封禁", icon: "success" })
        }).catch(function (error) {
          if (!page.isCurrentSessionRequest(requestEpoch)) return
          if (page.showSessionExpired(error)) return
          page.setData({ adminStatusChangingUserId: "" })
          wx.showToast({ title: serviceMessage(error), icon: "none" })
        })
      }
    })
  },

  bindProfile: function () {
    var page = this
    if (!this.data.isLoggedIn || this.data.bindingStatus !== "unbound" || this.data.isBindingProfile) return
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isBindingProfile: true })
    api.bindProfile({ name: this.data.studentName, studentNumber: this.data.studentId }).then(function (profile) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var binding = profile.privateBinding || {}
      page.setData({
        isBindingProfile: false,
        bindingStatus: profile.bindingStatus,
        studentName: binding.name || "",
        studentId: binding.studentNumber || "",
        hasStudentName: Boolean(binding.name),
        hasStudentId: Boolean(binding.studentNumber),
        serviceStatus: page.data.isCloudMode ? "云托管身份服务已连接" : "本地 API 已连接"
      })
      wx.showToast({ title: "身份资料已绑定", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isBindingProfile: false, serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
      if (error && error.code === "BINDING_CONFLICT") page.loadProfile()
    })
  },

  saveProfile: function () {
    var page = this
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: this.data.isTestIdentityMode ? "请先进入测试身份" : "请先使用微信登录", icon: "none" })
      return
    }
    if (this.data.isSavingProfile) return
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isSavingProfile: true })
    api.updateProfile({ nickname: this.data.nickname }).then(function (profile) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      page.setData({
        nickname: profile.nickname || page.data.nickname,
        avatarUrl: profile.avatarUrl || page.data.avatarUrl,
        isEditingProfile: false,
        isSavingProfile: false,
        serviceStatus: page.data.isCloudMode ? "云托管身份服务已连接" : "本地 API 已连接"
      })
      wx.showToast({ title: "昵称已更新", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.showSessionExpired(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isSavingProfile: false, serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  }
})
