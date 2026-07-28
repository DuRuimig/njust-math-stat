var library = require("../data/course-library")

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asText(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback === undefined ? "待补充" : fallback
  }
  return String(value)
}

function unique(values) {
  var seen = {}
  return values.filter(function (value) {
    if (!value || seen[value]) {
      return false
    }
    seen[value] = true
    return true
  })
}

function normalizeCourseName(value) {
  return String(value || "")
    .replace(/[\u3000\s]+/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .toLowerCase()
}

function sha256(value) {
  var text = unescape(encodeURIComponent(String(value)))
  var words = []
  var bitLength = text.length * 8
  var hash = [1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225]
  var constants = [1116352408, 1899447441, -1245643825, -373957723, 961987163, 1508970993, -1841331548, -1424204075, -670586216, 310598401, 607225278, 1426881987, 1925078388, -2132889090, -1680079193, -1046744716, -459576895, -272742522, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, -1740746414, -1473132947, -1341970488, -1084653625, -958395405, -710438585, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, -2117940946, -1838011259, -1564481375, -1474664885, -1035236496, -949202525, -778901479, -694614492, -200395387, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, -2067236844, -1933114872, -1866530822, -1538233109, -1090935817, -965641998]
  var index
  for (index = 0; index < text.length; index += 1) {
    words[index >> 2] = (words[index >> 2] || 0) | (text.charCodeAt(index) << (24 - (index % 4) * 8))
  }
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (128 << (24 - bitLength % 32))
  words[((bitLength + 64 >> 9) << 4) + 15] = bitLength
  for (var offset = 0; offset < words.length; offset += 16) {
    var schedule = []
    for (index = 0; index < 64; index += 1) {
      if (index < 16) {
        schedule[index] = words[offset + index] | 0
      } else {
        var gamma0 = schedule[index - 15]
        var gamma1 = schedule[index - 2]
        schedule[index] = (((gamma0 >>> 7) | (gamma0 << 25)) ^ ((gamma0 >>> 18) | (gamma0 << 14)) ^ (gamma0 >>> 3)) + schedule[index - 7] + (((gamma1 >>> 17) | (gamma1 << 15)) ^ ((gamma1 >>> 19) | (gamma1 << 13)) ^ (gamma1 >>> 10)) + schedule[index - 16]
      }
    }
    var a = hash[0]
    var b = hash[1]
    var c = hash[2]
    var d = hash[3]
    var e = hash[4]
    var f = hash[5]
    var g = hash[6]
    var h = hash[7]
    for (index = 0; index < 64; index += 1) {
      var sigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      var choose = (e & f) ^ (~e & g)
      var temp1 = h + sigma1 + choose + constants[index] + schedule[index]
      var sigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      var majority = (a & b) ^ (a & c) ^ (b & c)
      var temp2 = sigma0 + majority
      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }
    hash[0] = (hash[0] + a) | 0
    hash[1] = (hash[1] + b) | 0
    hash[2] = (hash[2] + c) | 0
    hash[3] = (hash[3] + d) | 0
    hash[4] = (hash[4] + e) | 0
    hash[5] = (hash[5] + f) | 0
    hash[6] = (hash[6] + g) | 0
    hash[7] = (hash[7] + h) | 0
  }
  return hash.map(function (part) {
    return ("00000000" + (part >>> 0).toString(16)).slice(-8)
  }).join("")
}

function teacherDirectoryId(teacher) {
  var sourceKey = teacher.academyDirectoryLink || (asText(teacher.name || teacher.teacherName, "") + "|" + asText(teacher.department || teacher.departmentName || teacher.unit, ""))
  return "directory:" + sha256(sourceKey)
}

function distinct(values) {
  return unique(values.map(function (value) {
    return value === undefined || value === null ? "" : String(value)
  }))
}

function currentLibrary() {
  return library && library.default ? library.default : (library || {})
}

function legacyCourseKey(course, index) {
  var code = asText(course.code || course.courseCode || course.id, "未编码")
  var major = asText(course.major || course.majorName, "未区分专业")
  return code + "::" + major + "::" + index
}

function legacyNameCourseKey(name) {
  return "course::" + encodeURIComponent(normalizeCourseName(name))
}

function stableCourseKey(name, code) {
  return legacyNameCourseKey(name) + "::" + encodeURIComponent(asText(code, "未编码"))
}

var STUDY_STAGE_BY_SEMESTER = {
  1: "大一上",
  2: "大一下",
  3: "大二上",
  4: "大二下",
  5: "大三上",
  6: "大三下",
  7: "大四上",
  8: "大四下"
}

function studyStageLabel(course) {
  var semester = Number(course.semester)
  if (STUDY_STAGE_BY_SEMESTER[semester]) {
    return STUDY_STAGE_BY_SEMESTER[semester]
  }
  var stage = String(course.stage || "")
  return Object.keys(STUDY_STAGE_BY_SEMESTER).some(function (key) {
    return STUDY_STAGE_BY_SEMESTER[key] === stage
  }) ? stage : "修读阶段待补充"
}

function normalizeCourse(course, index) {
  return {
    key: legacyCourseKey(course, index),
    name: asText(course.name || course.courseName, "课程名称待补充"),
    code: asText(course.code || course.courseCode || course.id, "待补充"),
    major: asText(course.major || course.majorName, "待补充"),
    requirement: asText(course.requirement || course.requiredType, "待补充"),
    credits: asText(course.credits, "待补充"),
    hours: asText(course.hours || course.totalHours, "待补充"),
    category: asText(course.category || course.courseCategory, "待补充"),
    semester: course.semester,
    studyStageLabel: studyStageLabel(course),
    source: asText(course.source || course.sourceLabel || getMeta().courseDefinitionSource, "课程清单")
  }
}

function displayMajorForVariant(course) {
  var semester = Number(course.semester)
  return semester >= 1 && semester <= 4 ? "数学类" : course.major
}

function commonValue(values) {
  var valuesFound = distinct(values)
  return valuesFound.length === 1 ? valuesFound[0] : null
}

function valueLabel(value, values) {
  if (value !== null && value !== undefined && value !== "") {
    return String(value)
  }
  return distinct(values).join(" / ") || "待补充"
}

function sourceTermRank(value) {
  var match = String(value || "").match(/^(\d{4})(春|夏|秋|冬)$/)
  if (!match) return 0
  return Number(match[1]) * 10 + ({ "春": 1, "夏": 2, "秋": 3, "冬": 4 }[match[2]] || 0)
}

function sourceTermLabel(value) {
  var match = String(value || "").match(/^(\d{4})(春|夏|秋|冬)$/)
  return match ? match[1] + "年" + match[2] : String(value || "")
}

function sortedSourceTerms(values) {
  return distinct(values).sort(function (left, right) {
    return sourceTermRank(left) - sourceTermRank(right) || left.localeCompare(right, "zh-CN")
  })
}

function textbookDisplay(record) {
  var book = textbookText(record)
  if (book === "来源标注：无指定教材") return "无指定教材"
  var publisher = asText(record && record.publisher, "")
  return publisher ? book + " · " + publisher : book
}

function textbooksForCourse(course) {
  var records = asArray(currentLibrary().offerings).filter(function (offering) {
    var offeringCode = offering.courseCode || offering.code || offering.courseId
    var hasOfferingCode = offeringCode !== undefined && offeringCode !== null && offeringCode !== ""
    if (hasOfferingCode) {
      return course.codeValues.indexOf(String(offeringCode)) >= 0
    }
    var offeringName = offering.courseName || offering.name
    return offeringName && normalizeCourseName(offeringName) === normalizeCourseName(course.name)
  })
  asArray(currentLibrary().teachingHistory).forEach(function (record) {
    if (course.codeValues.indexOf(String(record.courseCode || "")) >= 0) records.push(record)
  })
  if (!records.length) return ["教材待补充"]
  var latestRank = Math.max.apply(null, records.map(function (record) { return sourceTermRank(record.sourceTerm || record.sourceSemester) }))
  var latestRecords = latestRank ? records.filter(function (record) {
    return sourceTermRank(record.sourceTerm || record.sourceSemester) === latestRank
  }) : records
  var textbooks = distinct(latestRecords.map(textbookDisplay))
  return textbooks.length ? textbooks : ["教材待补充"]
}

function aggregateCourses() {
  var groups = {}
  var order = []
  asArray(currentLibrary().courses).forEach(function (rawCourse, index) {
    var normalized = normalizeCourse(rawCourse, index)
    var groupKey = stableCourseKey(normalized.name, normalized.code)
    if (!groups[groupKey]) {
      groups[groupKey] = {
        key: groupKey,
        name: normalized.name,
        legacyNameKey: legacyNameCourseKey(normalized.name),
        variants: [],
        legacyKeys: []
      }
      order.push(groups[groupKey])
    }
    groups[groupKey].variants.push(normalized)
    groups[groupKey].legacyKeys.push(normalized.key)
  })
  return order.map(function (group) {
    var variants = group.variants
    variants.forEach(function (variant) {
      variant.displayMajor = displayMajorForVariant(variant)
    })
    var aggregate = {
      key: group.key,
      legacyNameKey: group.legacyNameKey,
      legacyKeys: group.legacyKeys,
      name: group.name,
      variants: variants,
      majors: distinct(variants.map(function (item) { return item.major })),
      displayMajors: distinct(variants.map(function (item) {
        return item.displayMajor
      }))
    }
    ;["code", "requirement", "credits", "hours", "category", "semester", "studyStageLabel", "source"].forEach(function (field) {
      aggregate[field] = commonValue(variants.map(function (item) { return item[field] }))
    })
    aggregate.codeValues = distinct(variants.map(function (item) { return item.code }))
    aggregate.categoryValues = distinct(variants.map(function (item) { return item.category }))
    aggregate.studyStageLabels = distinct(variants.map(function (item) { return item.studyStageLabel }))
    aggregate.major = aggregate.majors.length === 1 ? aggregate.majors[0] : aggregate.majors.join("、")
    aggregate.majorLabel = aggregate.majors.join("、")
    aggregate.displayMajorLabel = aggregate.displayMajors.join("、")
    aggregate.codeLabel = valueLabel(aggregate.code, variants.map(function (item) { return item.code }))
    aggregate.requirementLabel = valueLabel(aggregate.requirement, variants.map(function (item) { return item.requirement }))
    aggregate.creditsLabel = valueLabel(aggregate.credits, variants.map(function (item) { return item.credits }))
    aggregate.hoursLabel = valueLabel(aggregate.hours, variants.map(function (item) { return item.hours }))
    aggregate.categoryLabel = valueLabel(aggregate.category, variants.map(function (item) { return item.category }))
    aggregate.studyStageLabelDisplay = aggregate.studyStageLabel || aggregate.studyStageLabels.join("、") || "修读阶段待补充"
    aggregate.semesterValues = distinct(variants.map(function (item) { return item.semester }))
    aggregate.textbooks = textbooksForCourse(aggregate)
    aggregate.textbookLabel = aggregate.textbooks.join("；")
    return aggregate
  })
}

function getCourses() {
  return aggregateCourses().sort(function (left, right) {
    var leftSemester = Number(left.semester) || 999
    var rightSemester = Number(right.semester) || 999
    if (leftSemester !== rightSemester) {
      return leftSemester - rightSemester
    }
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

function getMajors() {
  return unique([].concat.apply([], getCourses().map(function (course) { return course.displayMajors })))
}

function getStudyStages() {
  return unique([].concat.apply([], getCourses().map(function (course) {
    return course.studyStageLabels
  }))).sort(function (left, right) {
    var leftIndex = Object.keys(STUDY_STAGE_BY_SEMESTER).map(function (key) {
      return STUDY_STAGE_BY_SEMESTER[key]
    }).indexOf(left)
    var rightIndex = Object.keys(STUDY_STAGE_BY_SEMESTER).map(function (key) {
      return STUDY_STAGE_BY_SEMESTER[key]
    }).indexOf(right)
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
  })
}

function getMeta() {
  var data = currentLibrary()
  return data.meta || {}
}

function getCourseByKey(key) {
  return getCourseKeyResolution(key).course
}

function getCourseKeyResolution(key) {
  var courses = getCourses()
  var exact = courses.filter(function (course) {
    return course.key === key || course.legacyKeys.indexOf(key) >= 0
  })[0] || null
  if (exact) {
    return { course: exact, status: "resolved" }
  }
  var nameMatches = courses.filter(function (course) {
    return course.legacyNameKey === key
  })
  if (nameMatches.length === 1) {
    return { course: nameMatches[0], status: "resolved-legacy-name" }
  }
  if (nameMatches.length > 1) {
    return {
      course: null,
      status: "ambiguous-legacy-name",
      candidates: nameMatches.map(function (course) {
        return { key: course.key, name: course.name, codeLabel: course.codeLabel }
      })
    }
  }
  return { course: null, status: "not-found", candidates: [] }
}

function textbookText(offering) {
  var book = offering.textbook || offering.book || offering.material
  if (book === undefined || book === null || book === "") {
    return "教材待补充"
  }
  if (book === "无" || book === "-" || book === "暂无") {
    return "来源标注：无指定教材"
  }
  return String(book)
}

function courseNameForOffering(offering, course) {
  if (course) {
    return course.name
  }
  return asText(offering.courseName || offering.name, "课程名称待补充")
}

function normalizeOffering(offering, index) {
  var allCourses = getCourses()
  var code = asText(offering.courseCode || offering.code || offering.courseId, "待补充")
  var major = asText(offering.major || offering.majorName, "待补充")
  var offeringName = offering.courseName || offering.name
  var normalizedOfferingName = offeringName && normalizeCourseName(offeringName)
  var hasUsableCode = code !== "待补充"
  var matchedVariant = hasUsableCode ? allCourses.filter(function (course) {
    return course.variants.some(function (variant) {
      return variant.code === code && variant.major === major
    })
  })[0] || null : null
  var matched = matchedVariant || (hasUsableCode ? allCourses.filter(function (course) {
    return course.codeValues.indexOf(code) >= 0
  })[0] || null : null) || allCourses.filter(function (course) {
    return !hasUsableCode && normalizedOfferingName && normalizedOfferingName === normalizeCourseName(course.name)
  })[0] || null
  var resolvedMatchMethod = matchedVariant ? "code-and-major" : (matched && hasUsableCode ? "code" : (matched ? "name" : "unmatched"))
  var sourceTerm = asText(offering.sourceTerm || offering.sourceSemester, "来源学期待补充")
  return {
    key: code + "::" + major + "::" + index,
    courseKey: matched ? matched.key : "",
    matchMethod: asText(offering.matchMethod, "待补充"),
    resolvedMatchMethod: resolvedMatchMethod,
    courseCode: code,
    courseName: courseNameForOffering(offering, matched),
    major: major,
    term: asText(offering.term || offering.fixedTerm || offering.scheduleTerm, "开课周期待补充"),
    sourceTerm: sourceTerm,
    sourceTermLabel: sourceTermLabel(sourceTerm),
    latestTermRank: sourceTermRank(sourceTerm),
    teacher: asText(offering.teacher || offering.teacherName, "教师待补充"),
    offeringUnit: asText(offering.offeringUnit || offering.offering_unit, "开课院系待补充"),
    textbook: textbookText(offering),
    publisher: asText(offering.publisher, "待补充"),
    editor: asText(offering.editor || offering.author, "待补充"),
    source: asText(offering.source || offering.sourceLabel, "开课与教材匹配材料"),
    scope: asText(offering.scope, "major")
  }
}

function teacherNames(value) {
  var names = asText(value, "教师待补充").split(/[、,，/／]+/).map(function (name) {
    return name.trim()
  }).filter(function (name) {
    return Boolean(name)
  })
  return names.length ? unique(names) : ["教师待补充"]
}

function getOfferings() {
  var data = currentLibrary()
  return asArray(data.offerings).map(normalizeOffering)
}

function getOfferingsForCourse(course) {
  if (!course) {
    return []
  }
  return getOfferings().filter(function (offering) {
    return offering.courseKey === course.key
  })
}

function getCourseLevelTeachingRows() {
  var courses = getCourses()
  var rows = []
  asArray(currentLibrary().teachingHistory).forEach(function (record, index) {
    var code = asText(record.courseCode || record.code, "待补充")
    var course = courses.filter(function (item) { return item.codeValues.indexOf(code) >= 0 })[0] || null
    if (!course) return
    var term = asText(record.sourceTerm || record.sourceSemester, "来源学期待补充")
    teacherNames(record.teachers || record.teacher).forEach(function (teacherName, teacherIndex) {
      rows.push({
        key: code + "::course::" + index + "::" + teacherIndex,
        courseKey: course.key,
        matchMethod: "课程号",
        resolvedMatchMethod: "code",
        courseCode: code,
        courseName: course.name,
        major: "",
        term: sourceTermLabel(term),
        sourceTerm: term,
        sourceTermLabel: sourceTermLabel(term),
        latestTermRank: sourceTermRank(term),
        teacher: teacherName,
        offeringUnit: asText(record.offeringUnit || record.offering_unit, "开课院系待补充"),
        textbook: textbookText(record),
        publisher: asText(record.publisher, ""),
        editor: asText(record.editor || record.author, ""),
        source: asText(record.source || record.sourceLabel, "开课与教材匹配材料"),
        scope: "course"
      })
    })
  })
  return rows
}

function getTeacherOfferingGroupsForCourse(course) {
  var groups = {}
  var order = []
  getTeachingRows().filter(function (offering) { return offering.courseKey === course.key }).forEach(function (offering) {
    var variant = course.variants.filter(function (item) {
      return item.major === offering.major && item.code === offering.courseCode
    })[0] || course.variants.filter(function (item) {
      return item.major === offering.major
    })[0] || course
    teacherNames(offering.teacher).forEach(function (teacherName) {
      var groupKey = teacherName
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: course.key + "::teacher::" + encodeURIComponent(groupKey),
          teacher: teacherName,
          displayMajors: [],
          codes: [],
          sourceTerms: [],
          textbooks: [],
          offeringUnits: [],
          records: []
        }
        order.push(groups[groupKey])
      }
      var group = groups[groupKey]
      if (offering.scope !== "course") group.displayMajors.push(displayMajorForVariant(variant))
      group.codes.push(offering.courseCode)
      group.sourceTerms.push(offering.sourceTerm)
      group.textbooks.push(offering.textbook)
      group.offeringUnits.push(offering.offeringUnit)
      group.records.push(offering)
    })
  })
  return order.map(function (group) {
    group.displayMajors = distinct(group.displayMajors)
    group.codes = distinct(group.codes)
    group.sourceTerms = sortedSourceTerms(group.sourceTerms)
    group.textbooks = distinct(group.textbooks)
    group.offeringUnits = distinct(group.offeringUnits)
    group.displayMajorsLabel = group.displayMajors.join("、")
    group.codesLabel = group.codes.join("、")
    group.sourceTermsLabel = group.sourceTerms.map(sourceTermLabel).join("、")
    group.latestTermRank = Math.max.apply(null, group.sourceTerms.map(sourceTermRank))
    group.textbooksLabel = group.textbooks.join("；")
    group.offeringUnitsLabel = group.offeringUnits.join("、")
    return group
  }).sort(function (left, right) {
    return right.latestTermRank - left.latestTermRank || left.teacher.localeCompare(right.teacher, "zh-CN")
  })
}

function advisorText(teacher) {
  var roles = teacher.graduateAdvisorRoles
  if (Array.isArray(roles)) {
    return roles.length ? roles.join("；") : "研究生院导师目录未列明（不作资格否定）"
  }
  var value = teacher.graduateAdvisor0701 || teacher.advisorQualifications || teacher.advisorQualification || teacher.advisorStatus
  if (Array.isArray(value)) {
    return value.join("；") || "未收录"
  }
  if (value === "not_listed_in_0701_row") {
    return "0701 数学目录未列出（不作资格否定）"
  }
  if (teacher.graduateAdvisor0701) {
    return "0701 数学：" + value
  }
  return asText(value, "未收录")
}

function normalizeTeacher(teacher, index) {
  return {
    id: asText(teacher.id || teacher.teacherId || teacher.name, "teacher-" + index),
    directoryId: teacherDirectoryId(teacher),
    name: asText(teacher.name || teacher.teacherName, "姓名待补充"),
    department: asText(teacher.department || teacher.departmentName || teacher.unit, "未收录"),
    title: asText(teacher.title || teacher.position, "未收录"),
    advisorQualifications: advisorText(teacher),
    profileUrl: asText(teacher.academyDirectoryLink || teacher.profileUrl || teacher.url || teacher.publicProfile, ""),
    directorySource: asText(teacher.directorySource || teacher.source, "学院师资目录")
  }
}

function getTeachers() {
  var data = currentLibrary()
  return asArray(data.teachers).map(normalizeTeacher).sort(function (left, right) {
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

function sortTeachersByLikeCount(teachers) {
  return asArray(teachers).slice().sort(function (left, right) {
    var leftLikeCount = Number(left && left.likeCount)
    var rightLikeCount = Number(right && right.likeCount)
    leftLikeCount = Number.isFinite(leftLikeCount) ? leftLikeCount : 0
    rightLikeCount = Number.isFinite(rightLikeCount) ? rightLikeCount : 0
    return rightLikeCount - leftLikeCount || asText(left && left.name, "").localeCompare(asText(right && right.name, ""), "zh-CN")
  })
}

function getTeacherById(id) {
  return getTeachers().filter(function (teacher) {
    return teacher.id === id
  })[0] || null
}

function getTeacherByName(name) {
  return getTeachers().filter(function (teacher) {
    return teacher.name === name
  })[0] || null
}

function getTeacherByDirectoryId(directoryId) {
  return getTeachers().filter(function (teacher) {
    return teacher.directoryId === directoryId
  })[0] || null
}

function getTeachingRows() {
  return getOfferings().concat(getCourseLevelTeachingRows()).sort(function (left, right) {
    return left.courseName.localeCompare(right.courseName, "zh-CN") || right.latestTermRank - left.latestTermRank
  })
}

function getTeacherTeachingGroups() {
  var groups = {}
  var order = []
  getTeachingRows().forEach(function (offering) {
    var course = getCourseByKey(offering.courseKey)
    var variant = course && course.variants.filter(function (item) {
      return item.major === offering.major && item.code === offering.courseCode
    })[0] || null
    var courseKey = offering.courseKey || stableCourseKey(offering.courseName, offering.courseCode)
    var displayMajor = offering.scope === "course" ? "" : (variant ? displayMajorForVariant(variant) : offering.major)
    teacherNames(offering.teacher).forEach(function (teacherName) {
      if (!groups[teacherName]) {
        groups[teacherName] = {
          key: "teacher::" + encodeURIComponent(teacherName),
          teacher: teacherName,
          courses: []
        }
        order.push(groups[teacherName])
      }
      var group = groups[teacherName]
      var courseItem = group.courses.filter(function (item) {
        return item.key === courseKey
      })[0]
      if (!courseItem) {
        courseItem = {
          key: courseKey,
          name: course ? course.name : offering.courseName,
          majors: [],
          displayMajors: [],
          courseCodes: [],
          textbooks: [],
          offeringUnits: [],
          sourceTerms: [],
          records: []
        }
        group.courses.push(courseItem)
      }
      if (offering.major) courseItem.majors.push(offering.major)
      if (displayMajor) courseItem.displayMajors.push(displayMajor)
      courseItem.courseCodes.push(offering.courseCode)
      courseItem.textbooks.push(offering.textbook)
      courseItem.offeringUnits.push(offering.offeringUnit)
      courseItem.sourceTerms.push(offering.sourceTerm)
      courseItem.records.push(offering)
    })
  })
  return order.map(function (group) {
    group.courses.forEach(function (course) {
      course.majors = distinct(course.majors)
      course.displayMajors = distinct(course.displayMajors)
      course.courseCodes = distinct(course.courseCodes)
      course.textbooks = distinct(course.textbooks)
      course.offeringUnits = distinct(course.offeringUnits)
      course.sourceTerms = sortedSourceTerms(course.sourceTerms)
      course.majorLabel = course.majors.join("、")
      course.displayMajorLabel = course.displayMajors.join("、")
      course.courseCodeLabel = course.courseCodes.join("、")
      course.textbookLabel = course.textbooks.join("；")
      course.offeringUnitLabel = course.offeringUnits.join("、")
      course.sourceTermLabel = course.sourceTerms.map(sourceTermLabel).join("、")
      course.latestTermRank = Math.max.apply(null, course.sourceTerms.map(sourceTermRank))
    })
    group.courses.sort(function (left, right) {
      return left.name.localeCompare(right.name, "zh-CN")
    })
    return group
  }).sort(function (left, right) {
    return left.teacher.localeCompare(right.teacher, "zh-CN")
  })
}

module.exports = {
  asText: asText,
  getMeta: getMeta,
  getMajors: getMajors,
  getStudyStages: getStudyStages,
  getCourses: getCourses,
  getCourseByKey: getCourseByKey,
  getCourseKeyResolution: getCourseKeyResolution,
  getOfferings: getOfferings,
  getOfferingsForCourse: getOfferingsForCourse,
  getTeacherOfferingGroupsForCourse: getTeacherOfferingGroupsForCourse,
  getTeachers: getTeachers,
  sortTeachersByLikeCount: sortTeachersByLikeCount,
  getTeacherById: getTeacherById,
  getTeacherByName: getTeacherByName,
  getTeacherByDirectoryId: getTeacherByDirectoryId,
  teacherDirectoryId: teacherDirectoryId,
  getTeachingRows: getTeachingRows,
  getTeacherTeachingGroups: getTeacherTeachingGroups
}
