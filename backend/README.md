# Dream Builder API

The backend for Dream Builder, a storytelling app for children aged 8–14.
Node.js 24 + TypeScript, Express 5, MongoDB (Mongoose) and Zod. Every route lives under `/api/v1`.

The work is planned in [`docs/backend-guide.txt`](docs/backend-guide.txt) (stories BE-01 … BE-27).

## Local setup

You need:

| Tool | Version | Check with |
|---|---|---|
| Node.js | 24 or newer | `node -v` |
| pnpm | 12 | `pnpm -v` |
| MongoDB Community Server | 8 or newer, running on port 27017 | open MongoDB Compass and connect to `mongodb://127.0.0.1:27017` |

On Windows, install MongoDB with "Install MongoD as a Service" ticked, so it starts with the PC.
Any other way of running MongoDB works too (for example a Docker container: `docker run -d -p 27017:27017 mongo:8`).

Then, from this `backend/` folder:

```bash
pnpm install
cp .env.example .env          # then edit .env if you need different values
pnpm seed                     # optional: fill the local database with the Sprint 1 test data
pnpm dev                      # starts the API and restarts it when you save a file
```

Without Redis, story jobs run inside the API (fine on your PC). With Redis (see "Story generation"
below), set `REDIS_URL` in `.env` and also run `pnpm dev:worker` in a second terminal.

Check it works: open <http://localhost:3000/api/v1/health>. You should see:

```json
{ "status": "ok", "version": "1.0.0", "database": "connected" }
```

### pnpm notes

`backend/` has its own `pnpm-workspace.yaml`, so pnpm treats this folder as its own project and never
mixes in the frontend's packages from the parent folder. Run every command from inside `backend/`.

That file also lists the packages allowed to run install scripts (`allowBuilds`: esbuild, argon2).
If a new package needs one, the install stops with `ERR_PNPM_IGNORED_BUILDS`; add it with
`pnpm approve-builds <package>`.

## Environment variables

Settings come from environment variables. On your PC they live in `.env`, which is never committed.
`.env.example` is the template. On dev, staging and production, secrets come from the AWS secret store (AWS-01), never from the repo.

| Name | Required | Default | What it is |
|---|---|---|---|
| `MONGODB_URI` | yes | none | MongoDB address, e.g. `mongodb://127.0.0.1:27017/dream_builder`. Use `127.0.0.1`, not `localhost`: on some Windows PCs `localhost` means the IPv6 address `::1`, where MongoDB isn't listening. |
| `PORT` | no | `3000` | Port the API listens on. |
| `NODE_ENV` | no | `development` | `development`, `test` or `production`. In `development` the logs are coloured; otherwise they are JSON lines. |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `BUILD_VERSION` | no | `version` in `package.json` | Set by the deploy step (e.g. the git commit), shown by `/health`. |
| `JWT_ACCESS_SECRET` | yes | none | Signs access tokens. At least 32 random characters; the `.env.example` placeholder is refused. Secret: `.env` or the AWS secret store only. |
| `APP_URL` | no | `http://localhost:5173` | The frontend address used in email links (`/verify-email?token=…`, `/reset-password?token=…`). |
| `CONSENT_TEXT_VERSION` | no | `2026-11-v1` | Version of the consent text, saved on every consent record. |
| `TRUST_PROXY_HOPS` | no | `0` | Proxies in front of the API (1 behind the AWS load balancer), so `req.ip` is the parent's real IP. |

The API checks these at startup and stops with a clear message if one is missing or wrong.

## Running the tests

MongoDB must be running. Tests use their own database, `dream_builder_test`, so they never touch your dev data.

```bash
pnpm test               # all tests
pnpm test:unit          # unit tests: small pieces on their own, no database
pnpm test:integration   # integration tests: the real app against the test database
pnpm lint               # ESLint
pnpm typecheck          # TypeScript
```

CI runs lint, typecheck, unit tests and integration tests (against a MongoDB container) and a secret
scanner on every pull request. A pull request with a failing check cannot be merged.

## Folder layout

```
src/index.ts          starts the server (connects to MongoDB first)
src/app.ts            builds the Express app, mounts routes under /api/v1
src/config.ts         reads and checks environment variables
src/db/               MongoDB connection, seed data
src/db/models/        Mongoose models: one file per collection (see docs/data-model.md)
src/services/         real logic, e.g. storyLifecycle (allowed story status changes)
scripts/              command-line scripts (pnpm seed, pnpm users)
src/worker.ts         starts a queue worker (pnpm worker), apart from the API
src/jobs/             the job queue (queue.ts), one job try (runJob.ts), the AI providers
src/routes/           one Router per area
src/middleware/       validate, requestLogger, errorHandler
src/lib/              logger, errors (the shared error shape)
src/types/            shared types (StoryState etc.)
tests/unit/           unit tests
tests/integration/    integration tests
legacy/               old PGlite/Drizzle code, kept only as a reference while stories are rebuilt; not run or checked
docs/                 the backend guide and notes
```

## Accounts (BE-03)

All under `/api/v1/auth`:

| Route | What it does |
|---|---|
| `POST /register` | `{ name, email, password, adultConfirmed, consent }` → creates the parent and the consent record, emails a verification link, logs them in |
| `POST /verify-email` | `{ token }` from the email link. Works once, for 24 hours. |
| `POST /resend-verification` | Logged in. Sends a new verification link; older links stop working. |
| `POST /login` | `{ email, password, remember? }` |
| `POST /refresh` | Uses the refresh cookie to get a new access token |
| `POST /logout` | Ends this device's session |
| `POST /forgot-password` | `{ email }`. The same answer whether or not the email has an account. |
| `POST /reset-password` | `{ token, password }`. Logs out every device. |
| `GET /me` | The logged-in parent |

Login, register and refresh return `{ kind: "parent", user, accessToken, expiresIn }` (refresh in a child session returns `kind: "child"`, see below). Send the access token as
`Authorization: Bearer <accessToken>`; it lasts 15 minutes. The refresh token is only ever in the
`db_refresh` cookie (httpOnly, SameSite=Strict, Secure outside development, path `/api/v1/auth`).

**Emails on your PC** are not really sent: the dev mailer prints them in the terminal running
`pnpm dev`. Copy the link from there.

Error codes: `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `WEAK_PASSWORD`, `SESSION_EXPIRED`, `UNAUTHENTICATED`,
`CONSENT_REQUIRED`, `EMAIL_NOT_VERIFIED`, `LINK_INVALID`, `LINK_USED`, `LINK_EXPIRED`, `TOO_MANY_ATTEMPTS`.

Rate limits: 10 failed logins per email in 15 minutes; 5 sign-ups, and 5 forgot-password or resend
emails, per IP address per hour.

## Child profiles and child sessions (BE-04)

Child profiles, under `/api/v1/children`. Parent only, with a verified email and recorded consent:

| Route | What it does |
|---|---|
| `GET /` | My children (removed ones are hidden) |
| `POST /` | `{ name, age, language, mode? }` → 201. Age 8–14. No `mode`: under 12 is `junior` (Explorer), 12+ is `senior` (Creator). |
| `GET /:id` | One child |
| `PATCH /:id` | Any of `name`, `age`, `language`, `mode`. A new age keeps the stored mode. |
| `DELETE /:id` | Soft delete (`deletedAt` set, audit entry written) and ends that child's sessions. Full deletion comes with BE-16. |

Someone else's child, a removed child and a bad id all return 404. Each create, edit and remove is
written to `auditLogs`.

Child sessions, under `/api/v1/auth/child-session` (under `/auth` because they swap the refresh cookie):

| Route | What it does |
|---|---|
| `POST /` | Parent token, `{ childId }` → 201 `{ kind: "child", child, accessToken, expiresIn }`. The parent's session on this device ends; a child session starts (browser-session cookie, 12 hours at most). |
| `POST /exit` | Child token, `{ password }` (the parent's) → `{ kind: "parent", user, accessToken, expiresIn }` and a fresh parent session. 10 wrong passwords per parent in 15 minutes → 429. |

A child token (`role: "child_session"`) is refused (403) by every parent route. Story routes (BE-08)
use `allow("child_session")` and look stories up by the session's child, so a child reaches only their own stories.
Removing the child or exiting stops the child token at once, not 15 minutes later.

## Roles, access rules and audit log (BE-05)

Every route starts with one `allow(...)` (`src/middleware/access.ts`) naming who may call it:
`public`, `parent` (verified or not), `verified_parent`, `child_session`, `facilitator`, `admin`.
Not logged in → 401; logged in as the wrong kind → 403. `tests/integration/accessMatrix.test.ts`
calls every route as every kind of caller, and fails if a route has no `allow(...)` or isn't in
its matrix. **Adding a route? Add it to that matrix.**

Facilitator (read only), under `/api/v1/facilitator`:

| Route | What it does |
|---|---|
| `GET /children` | Children linked to me |
| `GET /children/:childId/stories` | That child's story history (no story text) |
| `GET /stories/:storyId` | Open one story (audit `story.view`) |

Admin, under `/api/v1/admin`:

| Route | What it does |
|---|---|
| `GET /audit-log` | Read the audit log, newest first. Filters: `actorId`, `targetType`, `targetId`, `action`; pages: `limit` (max 200), `before=<entry id>` |
| `GET /stories/:storyId` | Open any story (audit `story.view`) |

No route changes or deletes an audit entry, and the model refuses it too.

Staff accounts and facilitator links are made only with the script, never through sign-up:

```bash
pnpm users create   --role admin --email ali@example.com --name "Ali Khan"
pnpm users create   --role facilitator --email teacher@example.com --name "Ms Noor"
pnpm users set-role --email someone@example.com --role facilitator   # logs them out everywhere
pnpm users link     --facilitator teacher@example.com --child <child id>
pnpm users unlink   --facilitator teacher@example.com --child <child id>
```

A new account gets a "set your password" email (printed in the terminal on your PC).

Audit actions: `auth.sign_in`, `consent.record`, `child.create`, `child.update`, `child.delete`,
`child_session.start`, `child_session.exit`, `story.view`, `story.approve` (route in BE-12),
`user.create`, `user.role_change`, `facilitator.link`, `facilitator.unlink`. Each holds who, what,
which record, when and from where; never story text or secrets.

## Story drafts and the wizard (BE-08)

Under `/api/v1/stories`:

| Route | Who | What it does |
|---|---|---|
| `POST /` | child session | `{ authorName? }` → 201 a new draft for the child in this session, in that child's mode |
| `GET /` | child session, verified parent | Summaries, newest first. Child: my stories. Parent: my children's (`?childId=` for one child). |
| `GET /:id` | child session, verified parent | Every field of one story |
| `PATCH /:id` | child session | Save one wizard step: only the fields that changed. Drafts only (409 `STORY_NOT_DRAFT` otherwise). |
| `POST /:id/generate` | child session | 400 `STORY_INCOMPLETE` with `fields.missingSteps` if a step isn't done; otherwise 202, the story moves to `generating` and the job queue makes it (BE-07) |

Rules (`src/services/storyRules.ts`, option ids in `src/types/story.ts`, copied from the frontend's `content.ts`):

- Every answer must be a real option id; `heroPronoun` is `he` or `she` only. `status`, `mode`, `storyPath`, `childId`, `confirmedByChild` and `storyGeneratedAt` can't be sent.
- Mode rules: an Explorer draft refuses Creator strengths and Creator final-act feelings (and the other way round). The story keeps the mode it started with.
- `storyPath` follows `facesChallenge3` (true = `three_act`, false = `two_act`). Two acts clears `obstacles3`, `heartColor3`, `braveMove3`, `heroWords3` and `thirdChallengeText`, and refuses new Act 3 answers.
- `oneMoreAmazingThing` is trimmed, single-spaced and loses trailing full stops for every caller.
- `missingSteps` uses the frontend wizard's step names (`author`, `format`, `style`, `hero`, `heroName`, `strength`, `dream`, `act1.obstacle` … for Explorer, `act1` … for Creator, `rest`, `gate`), in wizard order.

Error codes: `STORY_NOT_DRAFT`, `STORY_INCOMPLETE`, `GENERATION_NOT_READY`.

## Story generation and the job queue (BE-07)

`POST /stories/:id/generate` moves the story to `generating` and puts jobs on a list. Workers do them:

```
story_text (writes every panel)  ─►  one panel_image job per panel
title
all done  ─►  story generating → child_review
```

| Route | Who | What it does |
|---|---|---|
| `GET /stories/:id/status` | child session, verified parent | `{ status, progress (0–100), panels: [{ number, textStatus, imageStatus }], failed: [...], canRetry }`. Final Climb asks every 2 seconds. |
| `POST /stories/:id/generate/retry` | child session | Puts the jobs that failed every try back on the list ("Try again"). 409 if none failed. |
| `GET /admin/stories/:id/progress` | admin | Book Progress Detail: the same status, plus every job (provider, model, duration, tries, error) and the story-rule violations |

How it stays reliable:

- **Retries:** each job gets `JOB_ATTEMPTS` tries (3), waiting `JOB_BACKOFF_MS` (5s), then twice that, then 4x.
  After the last try it is `failed` with its reason, and the story waits in `generating` for "Try again".
- **Time limits:** `TEXT_JOB_TIMEOUT_MS` (60s) and `IMAGE_JOB_TIMEOUT_MS` (120s) per try.
- **fal.ai limits:** `QUEUE_CONCURRENCY` jobs at once per worker (4), at most `AI_CALLS_PER_SECOND` starts a second (10).
- **A crashed worker:** its job's lock runs out and another worker retries it. Every job writes to its own
  panel number and is queued under a fixed key, so a retry never adds a second panel or job.
- **Every job records** provider, model, duration and tries.

The queue (`src/jobs/queue.ts`, the only file that knows the library):

| `REDIS_URL` | Queue | Who does the jobs |
|---|---|---|
| set (CI, AWS, or your PC with Redis) | BullMQ + Redis | `pnpm worker` (one or more), apart from the API |
| not set (your PC only) | in memory | the API itself; a restart puts unfinished jobs back. Refused in production. |

Redis on your PC (optional): Docker (`docker run -d -p 6379:6379 redis:7`), Memurai, or Redis in WSL.

Until BE-10 the AI is a **stub** (`AI_PROVIDER=stub`): placeholder text ("Panel 3 of Ember's story…") and
picture keys like `stub/<story id>/panel-03.webp`, after `STUB_DELAY_MS`. The rate-limit counts (BE-03) also
live in Redis when `REDIS_URL` is set.

## Known gaps

| Gap | Story | Notes |
|---|---|---|
| Google and Apple sign-in | BE-03 | Left for later (Sami Bhai's decision to make). Apple also waits for Dina's Apple developer account. |
| Real email sending | AWS-01 | Until Sami Bhai sets up email from Dina's domain, production only logs "email NOT sent". |
| The AI is a stub | BE-10 | Placeholder text and picture keys; BE-10 adds fal.ai (and BE-14 its anonymising gate). |
| Comic jobs and picture redraw | BE-11, BE-12 | `comic_script`, `comic_cell_image` and `panel_redraw` jobs fail with "aren't built yet". A comic story gets storybook panels for now. |
| Book Progress Detail screen | FE-15 | The admin API is ready; the frontend has no screen yet. |
| Redis on AWS | AWS-01 | Sami Bhai sets up ElastiCache in the UAE region; production refuses to start without `REDIS_URL`. |
| The worker-crash test needs Redis | BE-07 | It runs in CI (Redis service); on a PC without Redis it is skipped. |
| Queue library not yet confirmed | BE-07 | Built with BullMQ + Redis as recommended; waiting for Sami Bhai's OK. |
| Exact Creator-only field list | BE-08 | Not written in the guide; uses the Creator option lists from `content.ts`. Waiting for Sami Bhai (PRD). |
| `oneMoreAmazingThing` rule | BE-08 | Basic tidy-up only (defect 8). Waiting for Sami Bhai to confirm the PRD's rule. |
| Wizard and library on the real API | BE-08 / FE | The frontend still uses localStorage; wired together with the BE-04 handover screens. |
| A parent token stays valid up to 15 minutes after handover | BE-23 | It lives only in the page's memory and the frontend drops it at handover. |
| Facilitator portal screen (FE-14) | FE-14 | The API is ready; the frontend has no portal screen yet. |
| Story edit, redraw and approve routes in the access matrix | BE-08, BE-11, BE-12 | Facilitators must get 403 on them; add each to the matrix when built. |
| Admin second factor (MFA) | Later story in the guide | Admin login is password only for now. |
| Refresh-token rotation | BE-23 | The guide schedules rotation for BE-23. |
| A failed generation has no way back from `generating` | BE-07 | It waits there with "Try again" (decision 4A). Open question for Sami Bhai: allow `generating → draft`? |

## Errors

Every error uses one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found" } }
```

Invalid input also lists the problem per field:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields are missing or invalid", "fields": { "age": ["..."] } } }
```

`code` is stable, so the frontend can check it. `message` is for people and may change.
