var library = require("../../utils/library")
var api = require("../../utils/api")

function backendCourseKey(course) {
  var name = String(course.name || "")
  try { name = name.normalize("NFKC") } catch (_error) {}
  return String(course.code || "") + ":" + name.replace(/\s+/g, "")
}

function shouldShowSessionExpired(error) {
  return !(error && (error.sessionSuperseded || error.code === "SESSION_SUPERSEDED"))
}

Page({
  data: {
    course: null,
    directoryTeachers: [],
    keyResolution: "",
    ambiguousCandidates: [],
    feedbackConnected: false,
    teacherFeedbackConnected: false,
    isLoggedIn: false,
    hasLiked: false,
    likeCount: 0,
    isLiking: false,
    comments: [],
    commentText: "",
    isSubmittingComment: false
  },

  onLoad: function (options) {
    this.sessionRequestEpoch = 0
    this.feedbackSessionRevision = -1
    this.courseFeedbackLoading = false
    this.teacherFeedbackLoading = false
    var key = decodeURIComponent(options.key || "")
    var resolution = library.getCourseKeyResolution(key)
    var course = resolution.course
    if (!course) {
      this.setData({
        keyResolution: resolution.status,
        ambiguousCandidates: resolution.candidates || []
      })
      return
    }
    var teacherGroups = library.getTeacherOfferingGroupsForCourse(course)
    var directoryTeachers = []
    var used = {}
    teacherGroups.forEach(function (group) {
      var teacher = library.getTeacherByName(group.teacher)
      if (teacher && !used[teacher.id]) {
        used[teacher.id] = true
        directoryTeachers.push(teacher)
      }
    })
    this.setData({
      course: course,
      directoryTeachers: directoryTeachers,
      keyResolution: resolution.status
    })
    wx.setNavigationBarTitle({ title: course.name })
    this.refreshFeedback()
  },

  onShow: function () {
    if (!this.data.course) return
    var sessionChanged = this.feedbackSessionRevision !== api.getSessionRevision()
    var courseNeedsRetry = !this.data.feedbackConnected && !this.courseFeedbackLoading
    var teachersNeedRetry = this.data.directoryTeachers.length > 0 && !this.data.teacherFeedbackConnected && !this.teacherFeedbackLoading
    if (sessionChanged || courseNeedsRetry || teachersNeedRetry) this.refreshFeedback()
  },

  refreshFeedback: function () {
    if (!this.data.course) return
    this.sessionRequestEpoch = (this.sessionRequestEpoch || 0) + 1
    this.feedbackSessionRevision = api.getSessionRevision()
    this.loadFeedback(backendCourseKey(this.data.course))
    this.loadTeacherFeedbackSummary(this.data.directoryTeachers)
  },

  loadTeacherFeedbackSummary: function (teachers) {
    var page = this
    if (!teachers.length) {
      this.teacherFeedbackLoading = false
      this.setData({ teacherFeedbackConnected: true })
      return
    }
    this.teacherFeedbackLoading = true
    var requestEpoch = this.sessionRequestEpoch || 0
    api.getTeacherFeedbackSummary(teachers.map(function (teacher) { return teacher.directoryId })).then(function (response) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var summaries = response.items || []
      var byId = {}
      summaries.forEach(function (item) { byId[item.teacherId] = item })
      if (!Array.isArray(response.items) || teachers.some(function (teacher) {
        return !teacher.directoryId || !byId[teacher.directoryId] || !Number.isFinite(Number(byId[teacher.directoryId].likeCount))
      })) {
        throw new Error("教师点赞摘要不完整")
      }
      page.setData({
        teacherFeedbackConnected: true,
        directoryTeachers: teachers.map(function (teacher) {
          var summary = byId[teacher.directoryId]
          return Object.assign({}, teacher, {
            likeCount: Number(summary.likeCount) || 0,
            hasLiked: Boolean(summary.likedByMe),
            isLiking: false
          })
        })
      })
      page.teacherFeedbackLoading = false
    }).catch(function (_error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      page.teacherFeedbackLoading = false
      if (page.handleSessionInvalid(_error)) return
      page.setData({ teacherFeedbackConnected: false })
    })
  },

  loadFeedback: function (courseKey) {
    var page = this
    this.courseFeedbackLoading = true
    var requestEpoch = this.sessionRequestEpoch || 0
    api.getFeedback("courses", courseKey).then(function (feedback) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      page.setData({
        feedbackConnected: true,
        isLoggedIn: api.hasSession(),
        hasLiked: Boolean(feedback.likedByMe),
        likeCount: Number(feedback.likeCount) || 0,
        comments: Array.isArray(feedback.comments) ? feedback.comments.map(function (comment) {
          return { content: comment.content || "", createdAt: comment.createdAt || "" }
        }) : []
      })
      page.courseFeedbackLoading = false
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      page.courseFeedbackLoading = false
      if (page.handleSessionInvalid(error)) return
      page.setData({
        feedbackConnected: false
      })
    })
  },

  isCurrentSessionRequest: function (requestEpoch) {
    return requestEpoch === (this.sessionRequestEpoch || 0)
  },

  handleSessionInvalid: function (error) {
    if (!error || !error.sessionInvalid) return false
    if (error.sessionSuperseded) {
      this.sessionRequestEpoch = (this.sessionRequestEpoch || 0) + 1
      this.setData({
        feedbackConnected: false,
        teacherFeedbackConnected: false,
        isLoggedIn: api.hasSession(),
        hasLiked: false,
        isLiking: false,
        commentText: "",
        isSubmittingComment: false,
        directoryTeachers: this.data.directoryTeachers.map(function (teacher) {
          return Object.assign({}, teacher, { hasLiked: false, isLiking: false })
        })
      })
      this.refreshFeedback()
      return true
    }
    this.sessionRequestEpoch = (this.sessionRequestEpoch || 0) + 1
    this.setData({
      feedbackConnected: false,
      teacherFeedbackConnected: false,
      isLoggedIn: false,
      hasLiked: false,
      isLiking: false,
      commentText: "",
      isSubmittingComment: false,
      directoryTeachers: this.data.directoryTeachers.map(function (teacher) {
        return Object.assign({}, teacher, { hasLiked: false, isLiking: false })
      })
    })
    return true
  },

  likeCourse: function () {
    var page = this
    var course = this.data.course
    if (!course) {
      return
    }
    if (!this.data.feedbackConnected) {
      wx.showToast({ title: "互动服务未连接，无法点赞", icon: "none" })
      return
    }
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: "请先进入测试身份", icon: "none" })
      return
    }
    if (this.data.isLiking) return
    var wasLiked = this.data.hasLiked
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isLiking: true })
    var action = wasLiked ? api.unlike : api.like
    action("courses", backendCourseKey(course)).then(function (feedback) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (!feedback || feedback.liked !== !wasLiked || !Number.isFinite(Number(feedback.likeCount)) || Number(feedback.likeCount) < 0) {
        throw new Error("点赞服务返回无效结果")
      }
      page.setData({
        hasLiked: Boolean(feedback.liked),
        likeCount: Number(feedback.likeCount),
        isLiking: false
      })
      wx.showToast({ title: feedback.liked ? "已标记有帮助" : "已取消点赞", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var message = (error && error.message) || "服务未连接，请检查本地开发配置"
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isLiking: false })
      wx.showToast({ title: message, icon: "none" })
    })
  },

  likeTeacher: function (event) {
    var page = this
    var directoryId = event.currentTarget.dataset.id
    var teacher = this.data.directoryTeachers.filter(function (item) {
      return item.directoryId === directoryId
    })[0]
    if (!teacher) return
    if (!this.data.teacherFeedbackConnected) {
      wx.showToast({ title: "点赞服务未连接，无法点赞", icon: "none" })
      return
    }
    if (!api.hasSession()) {
      wx.showToast({ title: "请先进入测试身份", icon: "none" })
      return
    }
    if (teacher.isLiking) {
      return
    }
    var wasLiked = teacher.hasLiked
    var requestEpoch = this.sessionRequestEpoch || 0
    this.updateTeacher(directoryId, { isLiking: true })
    var action = wasLiked ? api.unlike : api.like
    action("teachers", directoryId).then(function (feedback) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      if (!feedback || feedback.liked !== !wasLiked || !Number.isFinite(Number(feedback.likeCount)) || Number(feedback.likeCount) < 0) {
        throw new Error("点赞服务返回无效结果")
      }
      page.updateTeacher(directoryId, {
        hasLiked: Boolean(feedback.liked),
        likeCount: Number(feedback.likeCount),
        isLiking: false
      })
      wx.showToast({ title: feedback.liked ? "点赞成功" : "已取消点赞", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var message = (error && error.message) || "点赞服务未连接"
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.updateTeacher(directoryId, { isLiking: false })
      wx.showToast({ title: message, icon: "none" })
    })
  },

  updateTeacher: function (directoryId, patch) {
    this.setData({
      directoryTeachers: this.data.directoryTeachers.map(function (teacher) {
        return teacher.directoryId === directoryId ? Object.assign({}, teacher, patch) : teacher
      })
    })
  },

  onCommentInput: function (event) {
    this.setData({ commentText: String(event.detail.value || "").slice(0, 300) })
  },

  submitComment: function () {
    var page = this
    var course = this.data.course
    if (!course) {
      return
    }
    if (!this.data.feedbackConnected) {
      wx.showToast({ title: "互动服务未连接，无法发布评论", icon: "none" })
      return
    }
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: "请先进入测试身份", icon: "none" })
      return
    }
    if (!this.data.hasLiked) {
      wx.showToast({ title: "点赞后才能评论", icon: "none" })
      return
    }
    if (!this.data.commentText.trim()) {
      wx.showToast({ title: "请输入 1 至 300 个字符的评论", icon: "none" })
      return
    }
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isSubmittingComment: true })
    api.postComment("courses", backendCourseKey(course), this.data.commentText).then(function (response) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var comment = response.comment || response
      page.setData({
        comments: comment ? [{ content: comment.content || "", createdAt: comment.createdAt || "" }].concat(page.data.comments) : page.data.comments,
        commentText: "",
        isSubmittingComment: false
      })
      wx.showToast({ title: "评论已发布", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentSessionRequest(requestEpoch)) return
      var message = (error && error.message) || "服务未连接，请检查本地开发配置"
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ feedbackConnected: false, isSubmittingComment: false })
      wx.showToast({ title: message, icon: "none" })
    })
  },

  goCatalog: function () {
    wx.switchTab({ url: "/pages/catalog/index" })
  }
})
