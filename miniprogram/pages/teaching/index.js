var library = require("../../utils/library")
var api = require("../../utils/api")

Page({
  data: {
    query: "",
    allTeachers: [],
    teachers: [],
    teacherCount: 0,
    feedbackConnected: false,
    feedbackStatus: ""
  },

  onLoad: function () {
    this.refresh()
  },

  onPullDownRefresh: function () {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  refresh: function () {
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
      teachers: teachers,
      teacherCount: teachers.length
    })
  },

  onQueryInput: function (event) {
    this.setData({ query: event.detail.value })
    this.applyFilter()
  },

  loadTeacherFeedbackSummary: function () {
    var page = this
    var teachers = library.getTeachers()
    api.getTeacherFeedbackSummary(teachers.map(function (teacher) { return teacher.directoryId })).then(function (response) {
      var summaries = response.items || []
      var byId = {}
      summaries.forEach(function (item) { byId[item.teacherId] = item })
      if (!Array.isArray(response.items) || teachers.some(function (teacher) {
        return !byId[teacher.directoryId] || !Number.isFinite(Number(byId[teacher.directoryId].likeCount))
      })) {
        throw new Error("点赞摘要不完整")
      }
      var mergedTeachers = teachers.map(function (teacher) {
        var summary = byId[teacher.directoryId] || {}
        return Object.assign({}, teacher, {
          likeCount: Number(summary.likeCount) || 0,
          hasLiked: Boolean(summary.likedByMe),
          isLiking: false
        })
      })
      page.setData({
        feedbackConnected: true,
        feedbackStatus: "",
        allTeachers: mergedTeachers
      })
      page.applyFilter()
    }).catch(function (error) {
      page.setData({
        feedbackConnected: false,
        feedbackStatus: "互动服务暂不可用，请稍后重试"
      })
    })
  },

  likeTeacher: function (event) {
    var page = this
    var teacherId = event.currentTarget.dataset.id
    var teacher = this.data.teachers.filter(function (item) { return item.id === teacherId })[0]
    if (!teacher) return
    if (!this.data.feedbackConnected) return wx.showToast({ title: "点赞服务未连接，无法点赞", icon: "none" })
    if (!api.hasSession()) return wx.showToast({ title: "请先使用本地测试身份进入", icon: "none" })
    if (teacher.isLiking) return
    var wasLiked = teacher.hasLiked
    this.updateTeacher(teacher.directoryId, { isLiking: true })
    var action = wasLiked ? api.unlike : api.like
    action("teachers", teacher.directoryId).then(function (feedback) {
      if (!feedback || feedback.liked !== !wasLiked || !Number.isFinite(Number(feedback.likeCount)) || Number(feedback.likeCount) < 0) {
        throw new Error("点赞服务返回无效结果")
      }
      page.updateTeacher(teacher.directoryId, { hasLiked: Boolean(feedback.liked), likeCount: Number(feedback.likeCount), isLiking: false })
      wx.showToast({ title: feedback.liked ? "点赞成功" : "已取消点赞", icon: "success" })
    }).catch(function (error) {
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
