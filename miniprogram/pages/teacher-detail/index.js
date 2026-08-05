var library = require("../../utils/library")
var api = require("../../utils/api")
var feedbackView = require("../../utils/feedback")

function shouldShowSessionExpired(error) {
  return !(error && (error.sessionSuperseded || error.code === "SESSION_SUPERSEDED"))
}

function openInvite(target) {
  wx.navigateTo({ url: "/pages/invite/index?target=" + encodeURIComponent(target || "/pages/profile/index") })
}

Page({
  data: {
    teacher: null,
    relatedCourses: [],
    missingTeacher: false,
    isLoggedIn: false,
    feedbackConnected: false,
    hasLiked: false,
    likeCount: 0,
    isLiking: false,
    comments: [],
    commentText: "",
    isSubmittingComment: false,
    deletingCommentId: ""
  },

  onLoad: function (options) {
    this.sessionRequestEpoch = 0
    this.feedbackSessionRevision = api.getSessionRevision()
    this.anonymousFeedbackRetrying = false
    var directoryId = decodeURIComponent(options.id || "")
    var teacher = library.getTeacherByDirectoryId(directoryId)
    if (!teacher) {
      this.setData({ missingTeacher: true })
      return
    }
    var teachingGroup = library.getTeacherTeachingGroups().filter(function (group) {
      return group.teacher === teacher.name
    })[0]
    this.setData({
      teacher: teacher,
      relatedCourses: teachingGroup ? teachingGroup.courses : [],
      isLoggedIn: api.hasSession()
    })
    wx.setNavigationBarTitle({ title: teacher.name })
  },

  onShow: function () {
    if (!this.data.teacher) return
    var sessionChanged = this.feedbackSessionRevision !== api.getSessionRevision()
    this.feedbackSessionRevision = api.getSessionRevision()
    this.sessionRequestEpoch += 1
    this.setData({ isLoggedIn: api.hasSession() })
    if (sessionChanged) {
      this.setData({ isLoggedIn: api.hasSession(), hasLiked: false, isLiking: false })
    }
    this.loadFeedback()
  },

  loadFeedback: function () {
    var page = this
    var requestEpoch = this.sessionRequestEpoch || 0
    api.getFeedback("teachers", this.data.teacher.directoryId).then(function (feedback) {
      if (!page.isCurrentRequest(requestEpoch)) return
      page.setData({
        feedbackConnected: true,
        isLoggedIn: api.hasSession(),
        hasLiked: Boolean(feedback.likedByMe),
        likeCount: Number(feedback.likeCount) || 0,
        comments: Array.isArray(feedback.comments) ? feedback.comments.map(feedbackView.normalizeComment) : []
      })
      page.anonymousFeedbackRetrying = false
    }).catch(function (error) {
      if (!page.isCurrentRequest(requestEpoch)) return
      if (page.handleSessionInvalid(error)) return
      page.anonymousFeedbackRetrying = false
      page.setData({ feedbackConnected: false, isLoggedIn: api.hasSession() })
    })
  },

  isCurrentRequest: function (requestEpoch) {
    return requestEpoch === (this.sessionRequestEpoch || 0)
  },

  handleSessionInvalid: function (error) {
    if (!error || !error.sessionInvalid) return false
    if (error.sessionSuperseded) {
      this.anonymousFeedbackRetrying = false
      this.sessionRequestEpoch += 1
      this.feedbackSessionRevision = api.getSessionRevision()
      this.setData({ isLoggedIn: api.hasSession(), hasLiked: false, isLiking: false, isSubmittingComment: false })
      this.loadFeedback()
      return true
    }
    var shouldRetryAnonymously = Boolean(this.data.teacher && !this.anonymousFeedbackRetrying)
    this.sessionRequestEpoch += 1
    this.setData({
      isLoggedIn: false,
      feedbackConnected: false,
      hasLiked: false,
      isLiking: false,
      commentText: "",
      isSubmittingComment: false,
      deletingCommentId: ""
    })
    if (shouldRetryAnonymously) {
      this.anonymousFeedbackRetrying = true
      this.loadFeedback()
    }
    return true
  },

  likeTeacher: function () {
    var page = this
    var teacher = this.data.teacher
    if (!teacher) return
    if (!api.hasSession()) return openInvite("/pages/teacher-detail/index?id=" + encodeURIComponent(teacher.directoryId))
    if (this.data.isLiking) return
    var wasLiked = this.data.hasLiked
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isLiking: true })
    var action = wasLiked ? api.unlike : api.like
    action("teachers", teacher.directoryId).then(function (feedback) {
      if (!page.isCurrentRequest(requestEpoch)) return
      page.setData({
        feedbackConnected: true,
        hasLiked: Boolean(feedback.liked),
        likeCount: Number(feedback.likeCount) || 0,
        isLiking: false
      })
      wx.showToast({ title: feedback.liked ? "点赞成功" : "已取消点赞", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentRequest(requestEpoch)) return
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isLiking: false })
      wx.showToast({ title: (error && error.message) || "点赞服务未连接", icon: "none" })
    })
  },

  onCommentInput: function (event) {
    this.setData({ commentText: String(event.detail.value || "").slice(0, 300) })
  },

  submitComment: function () {
    var page = this
    var teacher = this.data.teacher
    if (!teacher) return
    if (!this.data.isLoggedIn) return openInvite("/pages/teacher-detail/index?id=" + encodeURIComponent(teacher.directoryId))
    if (!this.data.hasLiked) return wx.showToast({ title: "点赞后可评价教师", icon: "none" })
    if (!this.data.commentText.trim()) return wx.showToast({ title: "请输入 1 至 300 个字符的评论", icon: "none" })
    var requestEpoch = this.sessionRequestEpoch || 0
    this.setData({ isSubmittingComment: true })
    api.postComment("teachers", teacher.directoryId, this.data.commentText).then(function (response) {
      if (!page.isCurrentRequest(requestEpoch)) return
      var comment = response.comment || response
      page.setData({
        feedbackConnected: true,
        comments: comment ? [feedbackView.normalizeComment(comment)].concat(page.data.comments) : page.data.comments,
        commentText: "",
        isSubmittingComment: false
      })
      wx.showToast({ title: "评价已发布", icon: "success" })
    }).catch(function (error) {
      if (!page.isCurrentRequest(requestEpoch)) return
      if (page.handleSessionInvalid(error)) {
        if (shouldShowSessionExpired(error)) wx.showToast({ title: "登录已失效，请重新登录", icon: "none" })
        return
      }
      page.setData({ isSubmittingComment: false })
      wx.showToast({ title: (error && error.message) || "评价发布失败", icon: "none" })
    })
  },

  deleteComment: function (event) {
    var page = this
    var commentId = event.currentTarget.dataset.id
    var comment = this.data.comments.filter(function (item) { return item.id === commentId })[0]
    if (!comment || (!comment.canDelete && !comment.canModerate) || this.data.deletingCommentId) return
    wx.showModal({
      title: "删除评价",
      content: "删除后无法恢复，确定继续吗？",
      success: function (result) {
        if (!result.confirm) return
        var requestEpoch = page.sessionRequestEpoch || 0
        page.setData({ deletingCommentId: commentId })
        api.deleteComment("teachers", page.data.teacher.directoryId, commentId).then(function () {
          if (!page.isCurrentRequest(requestEpoch)) return
          page.setData({ comments: page.data.comments.filter(function (item) { return item.id !== commentId }), deletingCommentId: "" })
          wx.showToast({ title: "评价已删除", icon: "success" })
        }).catch(function (error) {
          if (!page.isCurrentRequest(requestEpoch)) return
          if (page.handleSessionInvalid(error)) return
          page.setData({ deletingCommentId: "" })
          wx.showToast({ title: (error && error.message) || "删除失败，请稍后重试", icon: "none" })
        })
      }
    })
  },

  openCourse: function (event) {
    var key = event.currentTarget.dataset.key
    if (key) wx.navigateTo({ url: "/pages/course-detail/index?key=" + encodeURIComponent(key) })
  },

  goTeaching: function () {
    wx.switchTab({ url: "/pages/teaching/index" })
  }
})
