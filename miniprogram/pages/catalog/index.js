var library = require("../../utils/library")

Page({
  data: {
    query: "",
    selectedMajor: "全部专业",
    majorOptions: ["全部专业"],
    selectedStudyStage: "全部阶段",
    studyStageOptions: ["全部阶段"],
    courses: [],
    courseCount: 0,
    metaNote: "课程定义数据待同步。"
  },

  onLoad: function () {
    this.loadLibrary()
  },

  onPullDownRefresh: function () {
    this.loadLibrary()
    wx.stopPullDownRefresh()
  },

  loadLibrary: function () {
    var courses = library.getCourses()
    var majors = ["全部专业"].concat(library.getMajors())
    var studyStages = ["全部阶段"].concat(library.getStudyStages())
    var meta = library.getMeta()
    this.setData({
      majorOptions: majors,
      studyStageOptions: studyStages,
      metaNote: meta.dataStatus || "课程清单已加载；缺失字段保留为待补充。"
    })
    this.applyFilters()
  },

  applyFilters: function () {
    var data = this.data
    var query = data.query.trim().toLowerCase()
    var courses = library.getCourses().filter(function (course) {
      var matchesMajor = data.selectedMajor === "全部专业" || course.displayMajors.indexOf(data.selectedMajor) >= 0
      var matchesStudyStage = data.selectedStudyStage === "全部阶段" || course.studyStageLabels.indexOf(data.selectedStudyStage) >= 0
      var text = [course.name, course.codeValues.join(" "), course.majors.join(" "), course.displayMajors.join(" "), course.categoryValues.join(" ")].join(" ").toLowerCase()
      var matchesQuery = !query || text.indexOf(query) >= 0
      return matchesMajor && matchesStudyStage && matchesQuery
    })
    this.setData({
      courses: courses,
      courseCount: courses.length
    })
  },

  onQueryInput: function (event) {
    this.setData({ query: event.detail.value })
    this.applyFilters()
  },

  onPickMajor: function (event) {
    this.setData({ selectedMajor: this.data.majorOptions[event.detail.value] })
    this.applyFilters()
  },

  onPickStudyStage: function (event) {
    this.setData({ selectedStudyStage: this.data.studyStageOptions[event.detail.value] })
    this.applyFilters()
  },

  clearFilters: function () {
    this.setData({
      query: "",
      selectedMajor: "全部专业",
      selectedStudyStage: "全部阶段"
    })
    this.applyFilters()
  },

  goCourse: function (event) {
    var key = event.currentTarget.dataset.key
    wx.navigateTo({
      url: "/pages/course-detail/index?key=" + encodeURIComponent(key)
    })
  }
})
