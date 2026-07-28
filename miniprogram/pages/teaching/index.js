var library = require("../../utils/library")
var api = require("../../utils/api")

function resetTeacherIdentityState(teachers) {
  return (teachers || []).map(function (teacher) {
    return Object.assign({}, teacher, { hasLiked: false, isLiking: false })
  })
}

function shouldShowSessionExpired(error) {
  return !(error && (error.sessionSuperseded || error.code === "SESSION_SUPERSEDED"))
}

Page({
  data: {
    query: "",
    allTeachers: [],
    teachers: [],
    teacherCount: 0,
    isLoggedIn: false,
    feedbackConnected: false,
    feedbackStatus: ""
  },

  onLoad: function () {
    this.sessionRequestEpoch = 0
    this.applyFilter()
  },

  onShow: function () {
    this.refresh()
  },

  onPullDownRefresh: function () {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh: function () {
    this.nextSessionRequestEpoch()
    this.setData({
      isLoggedIn: api.hasSession(),
      feedbackConnected: false,
      feedbackStatus: "",
      allTeachers: resetTeacherIdentityState(this.data.allTeachers),
      teachers: resetTeacherIdentityState(this.data.teachers)
    })
    this.applyFilter()
    this.loadTeacherFeedbackSummary()
  },

  applyFilter: function () {
    var query = this.data.query.trim().toLowerCase()
    var allTeachers = this.data.allTeachers.length ? this.data.allTeachers : library.getTeachers()
    var teachers = allTeachers.filter(function (teacher) {
      return !query || [teacher.name, teacher.department].join(" ").toLowerCase().indexOf(query) >= 0
    })
    this.setData({
      allTeachers: allTeachers,
      teachers: teachers,
      teacherCount: teachers.length
    })
  },

  onQueryInput: function (event) {
    this.setData({ query: event.detail.value })
    this.applyFilter()
  },

  openTeacher: function (event) {
    var directoryId = event.currentTarget.dataset.id
    if (!directoryId) return
    wx.navigateTo({ url: "/pages/teacher-detail/index?id=" + encodeURIComponent(directoryId) })
  },

  loadTeacherFeedbackSummary: function () {
    var page = this
    var teachers = library.getTeachers()
    var requestEpoch = this.sessionRequestEpoch || 0
    api.getTeacherFeedbackSummary(teachers.map(function (teacher) { return teacher.directoryId })).then(function (response) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var summaries = response.items || []
      var byId = {}
      summaries.forEach(function (item) { byId[item.teacherId] = item })
      if (!Array.isArray(response.items) || teachers.some(function (teacher) {
        return !byId[teacher.directoryId] || !Number.isFinite(Number(byId[teacher.directoryId].likeCount))
      })) {
        throw new Error("点赞摘要不完整")
      }
      var isLoggedIn = api.hasSession()
      var mergedTeachers = teachers.map(function (teacher) {
        var summary = byId[teacher.directoryId] || {}
        return Object.assign({}, teacher, {
          likeCount: Number(summary.likeCount) || 0,
          hasLiked: isLoggedIn && Boolean(summary.likedByMe),
          isLiking: false
        })
      })
      page.setData({
        isLoggedIn: isLoggedIn,
        feedbackConnected: true,
        feedbackStatus: "",
        allTeachers: mergedTeachers
      })
      page.applyFilter()
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.handleSessionInvalid(error)) return
      page.setData({
        isLoggedIn: api.hasSession(),
        feedbackConnected: false,
        feedbackStatus: "互动服务暂不可用，请稍后重试",
        allTeachers: page.data.allTeachers.map(function (teacher) {
          return Object.assign({}, teacher, { isLiking: false })
        }),
        teachers: page.data.teachers.map(function (teacher) {
          return Object.assign({}, teacher, { isLiking: false })
        })
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

  handleSessionInvalid: function (error) {
    if (!error || !error.sessionInvalid) return false
    if (error.sessionSuperseded) {
      this.refresh()
      return true
    }
    this.nextSessionRequestEpoch()
    this.setData({
      isLoggedIn: false,
      feedbackConnected: false,
      feedbackStatus: "登录已失效，请重新登录",
      allTeachers: resetTeacherIdentityState(this.data.allTeachers),
      teachers: resetTeacherIdentityState(this.data.teachers)
    })
    return true
  },

  likeTeacher: function (event) {
    var page = this
    var teacherId = event.currentTarget.dataset.id
    var teacher = this.data.teachers.filter(function (item) { return item.id === teacherId })[0]
    if (!teacher) return
    if (!this.data.feedbackConnected) return wx.showToast({ title: "点赞服务未连接，无法点赞", icon: "none" })
    if (!this.data.isLoggedIn) return wx.showToast({ title: "请先进入测试身份", icon: "none" })
    if (!api.hasSession()) {
      this.handleSessionInvalid({ sessionInvalid: true })
      return wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
    }
    if (teacher.isLiking) return
    var wasLiked = teacher.hasLiked
    var requestEpoch = this.sessionRequestEpoch || 0
    this.updateTeacher(teacher.directoryId, { isLiking: true })
    var action = wasLiked ? api.unlike : api.like
    action("teachers", teacher.directoryId).then(function (feedback) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (!feedback || feedback.liked !== !wasLiked || !Number.isFinite(Number(feedback.likeCount)) || Number(feedback.likeCount) < 0) {
        throw new Error("点赞服务返回无效结果")
      }
      page.updateTeacher(teacher.directoryId, { hasLiked: Boolean(feedback.liked), likeCount: Number(feedback.likeCount), isLiking: false })
      wx.showToast({ title: feedback.liked ? "点赞成功" : "已取消点赞", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.updateTeacher(teacher.directoryId, { isLiking: false })
      wx.showToast({ title: (error && error.message) || "互动服务暂不可用，请稍后重试", icon: "none" })
    })
  },

  updateTeacher: function (directoryId, patch) {
    this.setData({
      allTeachers: this.data.allTeachers.map(function (teacher) {
        return teacher.directoryId === directoryId ? Object.assign({}, teacher, patch) : teacher
      }),
      teachers: this.data.teachers.map(function (teacher) {
        return teacher.directoryId === directoryId ? Object.assign({}, teacher, patch) : teacher
      })
    })
  }
})
