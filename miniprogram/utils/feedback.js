function pad2(value) {
  return String(value).padStart(2, "0")
}

function parseCommentTime(value) {
  var normalized = value
  if (typeof normalized === "string") {
    normalized = normalized.trim()
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
      normalized = normalized.replace(" ", "T") + "Z"
    }
  }
  return new Date(normalized)
}

function formatCommentTime(value) {
  if (!value) return ""
  var date = parseCommentTime(value)
  if (!Number.isFinite(date.getTime())) return ""
  return date.getFullYear() + "年" + (date.getMonth() + 1) + "月" + date.getDate() + "日 " + pad2(date.getHours()) + ":" + pad2(date.getMinutes())
}

function normalizeComment(comment) {
  var item = comment || {}
  return {
    id: item.id || "",
    content: item.content || "",
    authorNickname: item.authorNickname || "新同学",
    createdAt: item.createdAt || "",
    createdAtLabel: formatCommentTime(item.createdAt),
    canDelete: Boolean(item.canDelete),
    canModerate: Boolean(item.canModerate)
  }
}

module.exports = {
  parseCommentTime: parseCommentTime,
  formatCommentTime: formatCommentTime,
  normalizeComment: normalizeComment
}
