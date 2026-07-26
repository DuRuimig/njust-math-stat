from __future__ import annotations

import json
import re
from pathlib import Path


COURSE_PARSE = Path("work/course-parse.json")
TEXTBOOK_MATCHES = Path("/Users/drm/Documents/Codex/2026-07-18/new-chat/outputs/数统三专业课程教材匹配.md")
PDF_AUDIT = Path("work/pdf-audit/course-comparison.json")
TEACHER_DIRECTORY = Path("work/teacher-directory/teacher-directory.json")
OUTPUT = Path("prototype/data.js")
MINIPROGRAM_OUTPUT = Path("miniprogram/data/course-library.js")
COURSE_PATTERN = re.compile(r"^#### `(?P<code>[^`]+)` (?P<name>.+?)（(?P<credits>\d+)学分，(?P<details>.+)）$")
TERM_PATTERN = re.compile(r"^\*\*(2025秋|2026春)\*\*$")


def include_course(course: dict[str, object]) -> bool:
    practical_keywords = ("实践", "实习", "课程设计", "毕业设计", "科研训练")
    return (
        course["season"] != "夏"
        and course["category"] != "专业实践"
        and not any(keyword in str(course["name"]) for keyword in practical_keywords)
    )


def parse_offerings(allowed_keys: set[tuple[str, str]]) -> list[dict[str, str]]:
    major = None
    current: dict[str, str] | None = None
    entries: list[dict[str, str]] = []
    for line in TEXTBOOK_MATCHES.read_text(encoding="utf-8").splitlines():
        if line.startswith("## ") and line[3:] != "汇总":
            major = line[3:]
            current = None
            continue
        match = COURSE_PATTERN.match(line)
        if match:
            current = {"major": major or "", "code": match["code"], "term": ""}
            continue
        if current and TERM_PATTERN.match(line):
            current["term"] = line.strip("*")
            continue
        if not current or (current["major"], current["code"]) not in allowed_keys:
            continue
        if not line.startswith("| 课程"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 6 or cells[0] not in {"课程号", "课程名"}:
            continue
        entries.append({
            "major": current["major"],
            "courseCode": current["code"],
            "sourceTerm": current["term"],
            "term": f"每年{'秋季' if current['term'].endswith('秋') else '春季'}",
            "source": "用户提供的《数统三专业课程教材匹配》",
            "matchMethod": cells[0],
            "offeringUnit": cells[1],
            "teacher": cells[2],
            "textbook": cells[3],
            "publisher": cells[4],
            "editor": cells[5],
        })
    return list({tuple(entry.items()): entry for entry in entries}.values())


def load_verified_hours(allowed_keys: set[tuple[str, str]]) -> dict[tuple[str, str], int]:
    audit = json.loads(PDF_AUDIT.read_text(encoding="utf-8"))
    conflicting_keys = {
        (item["major"], item["code"])
        for item in audit["conflicts"]
        if (item["major"], item["code"]) in allowed_keys
    }
    if conflicting_keys:
        raise ValueError(f"Refusing to apply PDF hours for conflicting courses: {sorted(conflicting_keys)}")

    hours = {
        (item["major"], item["code"]): int(item["hours"])
        for item in audit["hours_fill_candidates"]
        if (item["major"], item["code"]) in allowed_keys and item["hours"] is not None
    }
    missing = allowed_keys - set(hours)
    if missing:
        raise ValueError(f"PDF hours are missing for: {sorted(missing)}")
    return hours


def load_teacher_directory() -> list[dict[str, object]]:
    directory = json.loads(TEACHER_DIRECTORY.read_text(encoding="utf-8"))
    return directory["teachers"]


def main() -> None:
    parsed = json.loads(COURSE_PARSE.read_text(encoding="utf-8"))
    courses = [{**course} for course in parsed["courses"] if include_course(course)]
    allowed_keys = {(course["major"], course["code"]) for course in courses}
    hours = load_verified_hours(allowed_keys)
    for course in courses:
        # Teaching assignments belong to offerings, never to a course definition.
        course.pop("teacher", None)
        course["hours"] = hours[(course["major"], course["code"])]
        course["hoursSource"] = "2022 培养方案 PDF"

    offerings = parse_offerings(allowed_keys)
    teachers = load_teacher_directory()
    payload = {
        "meta": {
            "dataStatus": "仅含三专业秋春常规专业课。课程定义来自用户提供清单；学时经 2022 培养方案 PDF 核验；开课安排按用户确认的春秋固定安排展示，并保留 2025秋、2026春来源学期。",
            "courseDefinitionSource": "用户提供的三份专业课程清单 Excel",
            "hoursSource": "【数统】本科人才培养方案(1).pdf（PDF 元数据日期：2022-11-11）",
            "offeringSource": "用户提供的《数统三专业课程教材匹配》",
            "staffDirectory": "https://math.njust.edu.cn/15518/list.htm",
            "graduateTutorDirectory": "https://gsmis.njust.edu.cn/open/DsDir_View.aspx?yxsh=130",
            "scheduleQuery": "http://bjkw.njust.edu.cn/njlgdx/kbcx/kbxx_teacher",
            "scheduleQueryNote": "教务排课查询页可用于后续逐条核验具体课程、学期与教师；本轮未将截图中的单条结果泛化为全量安排。",
            "courseCount": len(courses),
            "offeringCount": len(offerings),
            "teacherDirectoryCount": len(teachers),
        },
        "majors": ["数学与应用数学", "信息与计算科学", "应用统计学"],
        "courses": courses,
        "offerings": offerings,
        "teachers": teachers,
    }
    compact_payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text("window.COURSE_LIBRARY = " + compact_payload + ";\n", encoding="utf-8")
    MINIPROGRAM_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    MINIPROGRAM_OUTPUT.write_text("module.exports = " + compact_payload + ";\n", encoding="utf-8")
    print(f"Generated {len(courses)} courses, {len(offerings)} offering records, and {len(teachers)} teacher directory records.")


if __name__ == "__main__":
    main()
