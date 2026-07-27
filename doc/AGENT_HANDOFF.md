# Agent Handoff: Identity Login Work

## Purpose

This document records the current handoff point for the course library's test-identity and real WeChat login work. It is a status record, not deployment approval.

## Baseline and Git State

- Baseline commit: `1b66e5f6fb0ef56e31e83bec3d89730a0775ab08` (`feat: prepare cloud-hosted experience preview`).
- Current branch: `main...origin/main`.
- The index is empty. No current work has been committed, pushed, deployed, or uploaded as a WeChat experience version.
- At this handoff, `git status --short` reports 22 status records:
  - 17 modified tracked files;
  - the untracked `docs/` directory;
  - four untracked backend implementation or test files.
- `docs/` currently contains plan and specification material. Inspect it before any later staging decision; do not assume the 22 status records equal 22 individual files.

## Current Scope

The current work tree contains changes for:

- Cloud-mode test-identity login using a name and 12-digit student number, guarded by `ENABLE_TEST_IDENTITY_LOGIN=1` on the server.
- A real WeChat login implementation path:
  `wx.login` code -> `wx.cloud.callContainer` -> `/api/v1/auth/wechat` -> server-side `jscode2session` -> Bearer session.
- Server-side identity boundaries: the client does not supply a trusted OpenID; internal account keys use a `wechat:` SHA-256 digest; session storage uses token hashes.
- Session-loss and delayed-response isolation in the profile page, course-detail page, and teaching page.
- Documentation and configuration examples for the identity paths and SQLite experience limitations.

The current mini-program default remains cloud mode and test-identity mode. Test identity is not school authentication and must not be described as a formal authorization mechanism.

## Current P1: Old Request Must Not Clear New Session

The latest review identified this required check in `miniprogram/utils/api.js`:

1. Request A leaves with token A.
2. A later login persists token B.
3. Request A returns `401` with `SESSION_INVALID` or `AUTH_REQUIRED`.
4. Request A must not clear token B.

The current implementation includes request-session snapshots and `clearSessionForToken(expectedToken)`. The next agent must verify this behavior with a direct regression test before treating the P1 as closed:

- A same-token `401` clears that token.
- A token-A `401` after token B is persisted leaves token B available.
- The same replacement behavior is verified for `AUTH_REQUIRED`.
- `auth: false` requests do not clear an already established session.
- Network errors and `503` responses do not clear the session.

Do not rely only on page-level epoch tests. This is an API storage race and needs an API-layer assertion.

## Reported Local Checks

The prior agent report stated that the following checks had passed before this handoff:

```bash
cd project/backend && npm run check
cd project/backend && npm test
```

That report stated 5 test files and 61 passing tests, plus all mini-program JavaScript `node --check` checks and `git diff --check`.

These are reported results, not freshly rerun evidence for this handoff. Rerun the commands and record the actual output before staging or making any release claim.

## External Validation Still Missing

None of the following has been confirmed by this handoff:

- Real `wx.login` code exchange with WeChat.
- Real `jscode2session` using cloud-managed credentials.
- Cloud-hosting route behavior, environment-variable injection, or Bearer header forwarding.
- WeChat developer tools or real-device interaction.
- Docker image build and runtime health check.
- MySQL connection, migration, or concurrency behavior.
- Deployment, cloud environment changes, or WeChat experience-version upload.

SQLite is used for the experience container. User, session, like, comment, and profile-change data are subject to the container lifecycle and are not documented as durable across container replacement or scaling.

## Sensitive Configuration Boundary

The following names may be configured only in the cloud environment's secure configuration when separately authorized:

- `WX_MINIPROGRAM_APP_ID`
- `WX_MINIPROGRAM_APP_SECRET`

Do not write their values into Git, front-end configuration, Docker images, README examples, logs, screenshots, tests, or chat. Do not read or request real values during code review.

## Required Safety Boundaries

Until separately authorized, do not:

- Stage, commit, amend, push, deploy, upload an experience version, or change cloud environment variables.
- Change Dockerfile, cloud-hosting settings, GitHub permissions, MySQL configuration, migrations, or production data.
- Run `MYSQL_EXECUTE=1` or connect to a real MySQL instance.
- Use `git reset --hard`, `git checkout --`, `git clean`, force push, or bulk deletion.
- Revert, overwrite, or remove existing user work-tree changes.

## Next Minimal Work

1. Inspect `git status --short`, the full diff, and the untracked `docs/` directory before changing anything.
2. Add or verify the API-layer token-replacement race tests described above.
3. Rerun backend checks, backend tests, all mini-program JavaScript syntax checks, and whitespace checks.
4. Re-review the final exact staging set. Staging, committing, pushing, cloud credential entry, deployment, and experience upload each require separate confirmation.

## Domain Terms

Keep these course-library boundaries intact:

- A course definition is identified by major plus course code and does not imply teacher, textbook, or meeting time.
- A course offering is a source-semester record and is distinct from the public teacher directory.
- A teacher-directory entry only proves public directory information; it does not prove undergraduate teaching, title, or research direction.
- Advisor qualification only follows explicit entries in the `0701 Mathematics` advisor directory.
- Course material submission and AI Q&A remain local demonstration state unless separately authorized; do not infer a database, file upload, model, RAG, or WeChat login integration from those prototypes.
