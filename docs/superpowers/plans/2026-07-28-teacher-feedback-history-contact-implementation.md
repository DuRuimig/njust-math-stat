# Teacher Feedback, Teaching History, and Admin Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver teacher detail and feedback, current-nickname comments, append-only teaching history with latest textbooks, and the administrator QR contact flow without changing the existing mini-program visual language.

**Architecture:** Keep course definitions unchanged and add course-level `teachingHistory` records for the 2026 autumn workbook. Extend the existing library facade to merge historical offerings with course-level records, expose compact term labels, and choose only the latest textbook. Reuse the existing feedback API and page VM test harness; only the course comment endpoint drops the like requirement.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Node.js CommonJS, Express 4, SQLite/MySQL repositories, Vitest, Supertest.

## Global Constraints

- Preserve the current `surface`, spacing, typography, indigo/orange palette, and like-button dimensions.
- Course comments require login but not a course like; teacher comments require login and a teacher like.
- Comments are public to read and expose only current nickname, local-time display, body, and existing action permissions.
- Course basic information keeps its current layout; only the textbook value changes.
- Teacher cards show `2026年秋` or `2025年秋、2026年秋` without an “任课” prefix or suffix.
- Existing teachers remain; new terms append records and never overwrite teaching history.
- Do not alter course codes, names, credits, hours, majors, login mode, role model, MySQL migrations, or cloud configuration.
- Do not push, deploy cloud hosting, or upload an experience version.

---

### Task 1: Course-Level Teaching History and Latest Textbooks

**Files:**
- Create: `project/backend/test/library.test.js`
- Modify: `miniprogram/data/course-library.js`
- Modify: `miniprogram/utils/library.js`

**Interfaces:**
- Produces: `getTeacherOfferingGroupsForCourse(course)` groups with `sourceTerms`, `sourceTermsLabel`, and `latestTermRank`.
- Produces: `getTeacherTeachingGroups()` course entries with `sourceTermsLabel`.
- Produces: aggregate course `textbookLabel` containing only the latest known textbook and publisher.

- [x] **Step 1: Add a failing library behavior test**

```js
it('keeps past teachers while using the 2026 autumn textbook', () => {
  const course = library.getCourses().find((item) => item.codeValues.includes('71100201'));
  expect(course.textbookLabel).toBe('高等代数（第六版） · 高等教育出版社');
  expect(library.getTeacherOfferingGroupsForCourse(course).map((item) => ({
    teacher: item.teacher,
    terms: item.sourceTermsLabel,
  }))).toEqual(expect.arrayContaining([
    { teacher: '吕新民', terms: '2025年秋' },
    { teacher: '冯敏', terms: '2026年秋' },
  ]));
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `cd project/backend && npm test -- --run test/library.test.js`

Expected: failure because `teachingHistory` and compact term formatting do not exist.

- [x] **Step 3: Add normalized 2026 autumn data and merge logic**

Add one course-level record per exact course-code match with this shape:

```js
{
  courseCode: '71100201',
  sourceTerm: '2026秋',
  teachers: ['冯敏'],
  textbook: '高等代数（第六版）',
  publisher: '高等教育出版社',
  offeringUnit: '数学与统计学院',
  source: '2026夏秋学期各学院教材使用计划表'
}
```

Merge records by course code, teacher, and source term; format terms with `年`; sort teacher groups by latest term descending. Add a minimal `李超` teacher record with unknown fields left absent rather than guessed.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `cd project/backend && npm test -- --run test/library.test.js`

Expected: all library tests pass, including no duplicate course/teacher/term record.

### Task 2: Public Current-Nickname Comments and Split Like Requirements

**Files:**
- Modify: `project/backend/test/api.test.js`
- Modify: `project/backend/test/repository.test.js`
- Modify: `project/backend/src/repository.js`
- Modify: `project/backend/src/app.js`

**Interfaces:**
- `GET /api/v1/{courses|teachers}/:id/feedback` returns `authorNickname` and `createdAt` without private identity fields.
- `POST /api/v1/courses/:id/comments` requires login only.
- `POST /api/v1/teachers/:id/comments` still returns `LIKE_REQUIRED` before a teacher like.

- [x] **Step 1: Change the API test to require a course comment before liking and current nickname in both create and feedback responses**

Expected literal behavior: status `201`, `authorNickname: '新同学'`, and no `userId`, legal name, student number, or account ID.

- [x] **Step 2: Add a teacher test that expects `403 LIKE_REQUIRED` before liking and `201` after liking**

- [x] **Step 3: Run the focused API tests and verify RED**

Run: `cd project/backend && npm test -- --run test/api.test.js`

- [x] **Step 4: Join comments to `users.nickname`, return `authorNickname`, and branch the comment guard by target type**

Repository comment queries and create responses must read the current nickname. The route guard is:

```js
if (targetType === 'teacher' && !await repository.canComment(targetType, req.user.id, req.target.id)) {
  return apiError(res, 403, 'LIKE_REQUIRED', '点赞后才能评价教师');
}
```

- [x] **Step 5: Run API and repository tests and verify GREEN**

Run: `cd project/backend && npm test -- --run test/api.test.js test/repository.test.js`

### Task 3: Teacher Detail Page and Card Navigation

**Files:**
- Create: `miniprogram/pages/teacher-detail/index.js`
- Create: `miniprogram/pages/teacher-detail/index.json`
- Create: `miniprogram/pages/teacher-detail/index.wxml`
- Create: `miniprogram/pages/teacher-detail/index.wxss`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/teaching/index.js`
- Modify: `miniprogram/pages/teaching/index.wxml`
- Modify: `miniprogram/pages/teaching/index.wxss`
- Modify: `project/backend/test/miniprogram-api.test.js`

**Interfaces:**
- `openTeacher(event)` navigates to `/pages/teacher-detail/index?id=<encoded-directoryId>`.
- Teacher detail reads `directoryId`, teacher profile, related courses, feedback, and current session state.

- [x] **Step 1: Add failing page VM tests for card navigation and independent like taps**

Assert that card tap calls `wx.navigateTo`, while the like handler only calls the feedback API.

- [x] **Step 2: Add a failing teacher-detail VM test for disabled comments before a like and enabled comments after a like**

- [x] **Step 3: Implement teacher detail using existing page, card, feedback, comment, and like patterns**

The page order is profile, like control, related courses, and teacher comments. Missing profile fields render `未收录`; advisor status is omitted.

- [x] **Step 4: Run focused mini-program tests and verify GREEN**

Run: `cd project/backend && npm test -- --run test/miniprogram-api.test.js`

### Task 4: Course Detail Comments, Teaching Terms, and Latest Textbook

**Files:**
- Modify: `miniprogram/pages/course-detail/index.js`
- Modify: `miniprogram/pages/course-detail/index.wxml`
- Modify: `miniprogram/pages/course-detail/index.wxss`
- Modify: `project/backend/test/miniprogram-api.test.js`

**Interfaces:**
- Course comment composer depends on `isLoggedIn` and `isSubmittingComment`, not `hasLiked`.
- Teacher cards include `sourceTermsLabel` and navigate by `directoryId`; like buttons use `catchtap`.
- Comment view models expose `authorNickname` and a formatted local-time label.

- [x] **Step 1: Add failing VM tests for commenting without a course like, current nickname/time mapping, all historical teachers, and `2026年秋` labels**

- [x] **Step 2: Implement the minimal page changes while preserving the existing course-info grid**

Keep the `教材名称` cell in the same position. Render comment header as nickname plus formatted time. Add only one muted term line to each teacher card.

- [x] **Step 3: Run focused mini-program tests and verify GREEN**

Run: `cd project/backend && npm test -- --run test/miniprogram-api.test.js`

### Task 5: Administrator QR Contact Flow

**Files:**
- Restore: `miniprogram/assets/images/admin-wechat-qr.jpg`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `miniprogram/pages/profile/index.wxss`
- Modify: `project/backend/test/miniprogram-api.test.js`

**Interfaces:**
- `toggleAdminContact()` expands or collapses the contact button.
- `openAdminQr()` and `closeAdminQr()` control the modal.

- [x] **Step 1: Add failing VM tests for expand, open, content-tap stability, and close**

- [x] **Step 2: Restore the exact historical image blob and implement the two-stage interaction**

Use `aspectFit`, a fixed modal width, existing surface/indigo styles, a close button, and a visible image-error state.

- [x] **Step 3: Run focused mini-program tests and verify GREEN**

Run: `cd project/backend && npm test -- --run test/miniprogram-api.test.js`

### Task 6: Full Regression and Local Visual Verification

**Files:**
- Verify all changed files.

- [x] **Step 1: Run backend syntax and all tests**

Run: `cd project/backend && npm run check && npm test`

- [x] **Step 2: Check every mini-program JavaScript file and whitespace**

Run: `find miniprogram -name '*.js' -print0 | xargs -0 -n1 node --check && git diff --check`

- [x] **Step 3: Verify in WeChat Developer Tools**

Check course `71100201`, teacher directory navigation, teacher detail likes/comments, course comment without a like, dynamic nickname/time, QR modal, and a narrow phone viewport.

- [x] **Step 4: Review the complete diff and commit locally**

Commit only after tests and Developer Tools checks pass. Do not push or publish.
