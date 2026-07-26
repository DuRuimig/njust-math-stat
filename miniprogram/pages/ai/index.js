var library = require("../../utils/library")

function initialMessages() {
  return [{
    id: "intro",
    role: "assistant",
    content: "这是静态原型的问答界面。它没有接入 RAG、接口或外部知识内容，只会提示你到课程目录核对已同步的字段。"
  }]
}

function buildReply(question) {
  var value = question.toLowerCase()
  var matches = library.getCourses().filter(function (course) {
    return [course.name, course.codeLabel, course.majorLabel, course.displayMajorLabel, course.categoryLabel, course.semesterLabelDisplay].join(" ").toLowerCase().indexOf(value) >= 0
  }).slice(0, 3)
  if (!matches.length) {
    return "当前没有接入语义检索或 RAG。可到“课程目录”页按名称、代码、专业和专业分类查询；教师信息请以“教师”页为准。"
  }
  return "当前原型只进行了关键词匹配，未使用 RAG。你可以到“课程”页查看：" + matches.map(function (course) {
    return course.name + "（" + course.codeLabel + "，" + course.displayMajorLabel + "）"
  }).join("、") + "。课程定义和开课安排应分别核对。"
}

Page({
  data: {
    question: "",
    messages: initialMessages()
  },

  onLoad: function () {
    var saved = getApp().globalData.demoQuestions || []
    if (saved.length) {
      this.setData({ messages: initialMessages().concat(saved) })
    }
  },

  onQuestionInput: function (event) {
    this.setData({ question: event.detail.value })
  },

  sendQuestion: function () {
    var question = this.data.question.trim()
    if (!question) {
      wx.showToast({ title: "请输入课程问题", icon: "none" })
      return
    }
    var pair = [
      { id: "q-" + Date.now(), role: "user", content: question },
      { id: "a-" + Date.now(), role: "assistant", content: buildReply(question) }
    ]
    var history = (getApp().globalData.demoQuestions || []).concat(pair)
    getApp().globalData.demoQuestions = history
    this.setData({
      question: "",
      messages: initialMessages().concat(history)
    })
  },

  clearConversation: function () {
    getApp().globalData.demoQuestions = []
    this.setData({ messages: initialMessages() })
  }
})
