var api = require("../../utils/api")

function serviceMessage(error) {
  return (error && error.message) || "服务未连接，请检查本地开发配置"
}

Page({
  data: {
    loginStatus: "登录服务待配置",
    serviceStatus: "本地 API 未连接",
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
    isCreatingSession: false,
    isBindingProfile: false,
    isEditingProfile: false
  },

  onShow: function () {
    var app = typeof getApp === "function" ? getApp() : null
    this.setData({ isCloudMode: Boolean(app && app.globalData && app.globalData.apiMode === api.API_MODE_CLOUD) })
    this.loadProfile()
  },

  loadProfile: function () {
    if (this.data.isCloudMode) {
      this.setData({
        isLoggedIn: false,
        isDevelopmentSession: false,
        loginStatus: "登录服务待配置",
        serviceStatus: "体验版暂未开放身份与互动功能",
        studentName: "",
        studentId: "",
        hasStudentName: false,
        hasStudentId: false
      })
      return
    }
    if (!api.hasSession()) {
      this.setData({
        isLoggedIn: false,
        isDevelopmentSession: false,
        loginStatus: "登录服务待配置",
        serviceStatus: "尚未使用本地测试身份",
        studentName: "",
        studentId: "",
        hasStudentName: false,
        hasStudentId: false
      })
      return
    }
    var page = this
    api.getProfile().then(function (profile) {
      var binding = profile.privateBinding || {}
      page.setData({
        isLoggedIn: true,
        isDevelopmentSession: true,
        loginStatus: "开发测试身份",
        serviceStatus: "本地 API 已连接",
        nickname: profile.nickname || "",
        avatarUrl: profile.avatarUrl || "",
        bindingStatus: profile.bindingStatus || "real-login-pending",
        studentName: binding.name || "",
        studentId: binding.studentNumber || "",
        hasStudentName: Boolean(binding.name),
        hasStudentId: Boolean(binding.studentNumber)
      })
    }).catch(function (error) {
      page.setData({ serviceStatus: serviceMessage(error) })
    })
  },

  startDevelopmentSession: function () {
    var page = this
    this.setData({ isCreatingSession: true })
    api.createDevelopmentSession().then(function () {
      page.setData({ isCreatingSession: false })
      page.loadProfile()
      wx.showToast({ title: "已进入开发测试身份", icon: "success" })
    }).catch(function (error) {
      page.setData({ isCreatingSession: false, serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  },

  toggleProfileEditor: function () {
    this.setData({ isEditingProfile: !this.data.isEditingProfile })
  },

  onNicknameInput: function (event) {
    this.setData({ nickname: String(event.detail.value || "").slice(0, 24) })
  },

  onChooseAvatar: function (event) {
    this.setData({ avatarUrl: event.detail.avatarUrl || "" })
  },

  onStudentNameInput: function (event) {
    this.setData({ studentName: String(event.detail.value || "").slice(0, 80) })
  },

  onStudentIdInput: function (event) {
    this.setData({ studentId: String(event.detail.value || "").slice(0, 32) })
  },

  bindProfile: function () {
    var page = this
    if (!this.data.isLoggedIn || this.data.bindingStatus !== "unbound") return
    this.setData({ isBindingProfile: true })
    api.bindProfile({ name: this.data.studentName, studentNumber: this.data.studentId }).then(function (profile) {
      var binding = profile.privateBinding || {}
      page.setData({
        isBindingProfile: false,
        bindingStatus: profile.bindingStatus,
        studentName: binding.name || "",
        studentId: binding.studentNumber || "",
        hasStudentName: Boolean(binding.name),
        hasStudentId: Boolean(binding.studentNumber),
        serviceStatus: "本地 API 已连接"
      })
      wx.showToast({ title: "身份资料已绑定", icon: "success" })
    }).catch(function (error) {
      page.setData({ isBindingProfile: false, serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
      if (error && error.code === "BINDING_CONFLICT") page.loadProfile()
    })
  },

  saveProfile: function () {
    var page = this
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: "请先使用本地测试身份进入", icon: "none" })
      return
    }
    api.updateProfile({ nickname: this.data.nickname, avatarUrl: this.data.avatarUrl }).then(function (profile) {
      page.setData({
        nickname: profile.nickname || page.data.nickname,
        avatarUrl: profile.avatarUrl || page.data.avatarUrl,
        isEditingProfile: false,
        serviceStatus: "本地 API 已连接"
      })
      wx.showToast({ title: "资料已更新", icon: "success" })
    }).catch(function (error) {
      page.setData({ serviceStatus: serviceMessage(error) })
      wx.showToast({ title: serviceMessage(error), icon: "none" })
    })
  }
})
