from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path


PDF_TEXT = Path("work/pdf-audit/source-layout.txt")
CURRENT = Path("work/course-parse.json")
RUNTIME = Path("prototype/data.js")
RESULT = Path("work/pdf-audit/course-comparison.json")

# These ranges are the three professional "指导性教学计划" tables in the extracted PDF.
MAJOR_RANGES = {
    "数学与应用数学": (507, 585),
    "信息与计算科学": (1136, 1219),
    "应用统计学": (1768, 1855),
}

CODE_RE = re.compile(r"^\s*(?P<code>\d{8}[A-Z]?)\s+(?P<rest>.*)$")


def compact(value: str) -> str:
    """Normalize table extraction noise without changing a course's meaning."""
    value = value.replace("（I）", "（Ⅰ）").replace("（II）", "（Ⅱ）")
    return re.sub(r"\s+", "", value)


def parse_table_rows(lines: list[str], start: int, end: int, expected: dict[str, dict]) -> list[dict]:
    category: str | None = None
    requirement: str | None = None
    rows: list[dict] = []

    index = start - 1
    while index < end:
        line = lines[index]
        if "（二）学科教育" in line:
            category, requirement = "学科教育", "必修"
        elif "1. 专业基础课" in line or "1.专业基础课" in line:
            category, requirement = "专业基础", "必修"
        elif "2. 专业选修课" in line or "2.专业选修课" in line or "交叉融合课" in line:
            category, requirement = "专业选修", "选修"
        elif "3.毕业设计" in line or "3. 毕业设计" in line:
            category, requirement = "专业实践", "必修"

        match = CODE_RE.match(line)
        if not match or match["code"] not in expected:
            index += 1
            continue

        code = match["code"]
        current = expected[code]
        # A few extracted rows wrap the course name around the code, so inspect
        # the adjacent lines for the name while keeping the actual code line for
        # numerical fields.
        name_window = " ".join(lines[max(start - 1, index - 1):min(end, index + 2)])
        row_text = compact(name_window)
        course_name = compact(current["name"])
        name_position = row_text.find(course_name)
        row_fields = match["rest"]
        if course_name in compact(row_fields):
            name_start = compact(row_fields).find(course_name)
            # The table's field separators are whitespace. Locate the original
            # course name before extracting numeric fields from its suffix.
            name_pattern = re.escape(current["name"]).replace(r"\\ ", r"\\s*")
            raw_match = re.search(name_pattern, row_fields)
            if raw_match:
                row_fields = row_fields[raw_match.end():]
        numeric_fields = re.findall(r"\d+(?:\.\d+)?", row_fields)
        # In two cross-disciplinary rows the code, an "R" marker, and the
        # numeric fields are emitted on separate lines. Extend only incomplete
        # rows, so ordinary rows do not consume the following course.
        if len(numeric_fields) < 2:
            cursor = index + 1
            while cursor < end and not CODE_RE.match(lines[cursor]):
                if "（四）实践课程体系" in lines[cursor]:
                    break
                row_fields += " " + lines[cursor]
                numeric_fields = re.findall(r"\d+(?:\.\d+)?", row_fields)
                if len(numeric_fields) >= 2:
                    break
                cursor += 1
        term_match = re.search(r"([秋春夏])\s*(\d)", row_fields)

        neighbor_text = compact(" ".join([
            lines[index - 1] if index > start - 1 else "",
            lines[index + 1] if index + 1 < end else "",
        ]))
        name_detected = name_position >= 0 or course_name in neighbor_text

        rows.append({
            "code": code,
            "source_line": index + 1,
            "name_detected": name_detected,
            "credits": float(numeric_fields[0]) if numeric_fields else None,
            "hours": int(float(numeric_fields[1])) if len(numeric_fields) > 1 else None,
            "season": term_match.group(1) if term_match else None,
            "semester": int(term_match.group(2)) if term_match else None,
            "category": category,
            "requirement": requirement,
        })
        index += 1
    return rows


def load_runtime_courses() -> list[dict]:
    text = RUNTIME.read_text(encoding="utf-8").strip()
    prefix = "window.COURSE_LIBRARY = "
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValueError("prototype/data.js is not the expected static data assignment")
    return json.loads(text[len(prefix):-1])["courses"]


def main() -> None:
    # Keep form-feed characters inside their original line; str.splitlines()
    # would count each PDF page break as a separate line and shift source ranges.
    lines = PDF_TEXT.read_text(encoding="utf-8").split("\n")
    current_payload = json.loads(CURRENT.read_text(encoding="utf-8"))
    current_courses = current_payload["courses"]
    runtime_courses = load_runtime_courses()

    current_by_major: dict[str, dict[str, dict]] = defaultdict(dict)
    for course in current_courses:
        current_by_major[course["major"]][course["code"]] = course

    output: dict[str, object] = {
        "source": {
            "pdf_text": str(PDF_TEXT),
            "pdf_metadata": {"creator": "Aspose Ltd.", "creation_date": "2022-11-11", "page_count": 44},
            "scope": "PDF 中三个专业的指导性教学计划表；不把学院简介或流程图当作课程定义来源。",
        },
        "summary": {},
        "conflicts": [],
        "missing_from_pdf_tables": [],
        "extra_in_pdf_tables": [],
        "hours_fill_candidates": [],
        "runtime_check": {},
    }

    all_official_rows: list[tuple[str, dict]] = []
    for major, (start, end) in MAJOR_RANGES.items():
        expected = current_by_major[major]
        official_rows = parse_table_rows(lines, start, end, expected)
        official_by_code = {row["code"]: row for row in official_rows}
        all_official_rows.extend((major, row) for row in official_rows)

        current_codes = set(expected)
        official_codes = set(official_by_code)
        output["summary"][major] = {
            "current_course_count": len(current_codes),
            "official_table_course_count": len(official_codes),
            "current_categories": dict(Counter(course["category"] for course in expected.values())),
            "official_categories": dict(Counter(str(row["category"]) for row in official_rows)),
        }

        for code in sorted(current_codes - official_codes):
            output["missing_from_pdf_tables"].append({"major": major, "code": code, "name": expected[code]["name"]})
        for code in sorted(official_codes - current_codes):
            output["extra_in_pdf_tables"].append({"major": major, "code": code})

        for code in sorted(current_codes & official_codes):
            current = expected[code]
            official = official_by_code[code]
            fields = ("credits", "season", "semester", "category", "requirement")
            differences = {
                field: {"current": current[field], "official": official[field]}
                for field in fields
                if current[field] != official[field]
            }
            if not official["name_detected"]:
                differences["name"] = {"current": current["name"], "official": "not detected in source row"}
            if differences:
                output["conflicts"].append({"major": major, "code": code, "name": current["name"], "differences": differences})
            if current["hours"] is None and official["hours"] is not None:
                output["hours_fill_candidates"].append({
                    "major": major,
                    "code": code,
                    "name": current["name"],
                    "hours": official["hours"],
                    "source_line": official["source_line"],
                })

    runtime_keys = {(course["major"], course["code"]) for course in runtime_courses}
    current_keys = {(course["major"], course["code"]) for course in current_courses}
    official_lookup = {(major, row["code"]): row for major, row in all_official_rows}
    runtime_hours_fill_candidates = []
    runtime_unmatched = []
    for course in runtime_courses:
        key = (course["major"], course["code"])
        official = official_lookup.get(key)
        if official and official["hours"] is not None:
            runtime_hours_fill_candidates.append({
                "major": course["major"],
                "code": course["code"],
                "name": course["name"],
                "hours": official["hours"],
                "source_line": official["source_line"],
            })
        else:
            runtime_unmatched.append({"major": course["major"], "code": course["code"], "name": course["name"]})
    output["runtime_hours_fill_candidates"] = runtime_hours_fill_candidates
    output["runtime_unmatched"] = runtime_unmatched
    output["runtime_check"] = {
        "runtime_course_count": len(runtime_courses),
        "all_runtime_courses_are_in_current_parse": runtime_keys <= current_keys,
        "runtime_courses_with_missing_hours": sum(course.get("hours") is None for course in runtime_courses),
        "runtime_hours_fill_candidate_count": len(runtime_hours_fill_candidates),
        "runtime_unmatched_count": len(runtime_unmatched),
        "hours_distribution": dict(sorted(Counter(item["hours"] for item in runtime_hours_fill_candidates).items())),
    }
    output["summary"]["all"] = {
        "current_course_count": len(current_courses),
        "official_rows_parsed": len(all_official_rows),
        "field_conflict_count": len(output["conflicts"]),
        "missing_from_pdf_table_count": len(output["missing_from_pdf_tables"]),
        "extra_in_pdf_table_count": len(output["extra_in_pdf_tables"]),
        "hours_fill_candidate_count": len(output["hours_fill_candidates"]),
    }

    RESULT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
