# Dream Builder API

The backend for Dream Builder, a storytelling app for children aged 8–14.
Node.js 24 + TypeScript, Express 5, MongoDB (Mongoose) and Zod. Every route lives under `/api/v1`.

The work is planned in [`docs/backend-guide.txt`](docs/backend-guide.txt) (stories BE-01 … BE-27).
How stories are made, from the wizard to the finished panels, with every term explained:
[`docs/story-system.md`](docs/story-system.md).

## Local setup

You need:

| Tool | Version | Check with |
|---|---|---|
| Node.js | 24 or newer | `node -v` |
| pnpm | 12 | `pnpm -v` |
| MongoDB Community Server | 8 or newer, running on port 27017 | open MongoDB Compass and connect to `mongodb://127.0.0.1:27017` |

On Windows, install MongoDB with "Install MongoD as a Service" ticked, so it starts with the PC.
Any other way of running MongoDB works too (for example a Docker container: `docker run -d -p 27017:27017 mongo:8`).

Install once from the **repo root** (`pnpm install`), then from this `apps/api/` folder:

```bash
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

This app is part of the monorepo: one `pnpm-workspace.yaml` and one `pnpm-lock.yaml` at the repo root.
Install from the root. Scripts run from this folder (`pnpm dev`, `pnpm test`), or from the root with
`pnpm --filter @dream-builder/api <script>`. Add a package with `pnpm add <pkg>` from this folder.

The root `pnpm-workspace.yaml` also lists the packages allowed to run install scripts (`allowBuilds`: esbuild, argon2).
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
| `AI_PROVIDER` | no | `stub` | `fal` = the real AI (BE-10), `gemini` / `cloudflare` = that service for both, `stub` = fake text and placeholder pictures. |
| `AI_TEXT_PROVIDER` / `AI_IMAGE_PROVIDER` | no | `AI_PROVIDER` | Pick the text and the pictures separately, e.g. the free mix `gemini` + `cloudflare`. See "Free AI for testing". |
| `FAL_KEY` | with `fal` | none | The fal.ai key. Secret: `.env` or the AWS secret store only. |
| `GEMINI_API_KEY` | with `gemini` | none | From aistudio.google.com. Models: `GEMINI_TEXT_MODEL` (`gemini-2.5-flash`), `GEMINI_IMAGE_MODEL` (`gemini-2.5-flash-image`, paid). |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | with `cloudflare` | none | A token with only the Workers AI permission. Models: `CLOUDFLARE_TEXT_MODEL`, `CLOUDFLARE_IMAGE_MODEL` (FLUX schnell: 1024 squares; `@cf/black-forest-labs/flux-2-klein-4b`: each picture in its panel's shape, up to 1920 px), `CLOUDFLARE_IMAGE_STEPS` (4, schnell only). |
| `IMAGE_LONG_SIDE` | no | `2048` | The long side of every AI picture, in px. Pictures are made in the shape they're printed in (storybook 16:10, each comic panel its frame's shape), so 2048 prints at about 300 dpi. fal.ai makes it exactly; Cloudflare FLUX.2 up to 1920; Gemini the nearest of its shapes ("2K" on Gemini 3 image models). |
| `FAL_TEXT_MODEL` / `FAL_IMAGE_MODEL` | no | `google/gemini-2.5-flash` / `fal-ai/flux/dev` | The text model (behind `fal-ai/any-llm`) and the FLUX model. Sami Bhai confirms the text model. |
| `S3_BUCKET` | in production | none | The picture bucket in the AWS UAE region (`S3_REGION`, default `me-central-1`). Not set: pictures go to `STORAGE_DIR` (`data/storage`). |
| `IMAGE_URL_TTL_SECONDS` | no | `3600` | How long a picture link given to the app keeps working. |
| `API_URL` | no | `http://localhost:3000` | The API's own address, for links to pictures in the local folder. |
| `PRINT_PROFILE` / `DOWNLOAD_PROFILE` | no | `generic` / `digital` | BE-18: the print profile for a hardback's printer file, and for the parent's download (`src/print/profiles.ts`). |
| `BOOK_PDF_TIMEOUT_MS` | no | `120000` | How long one book PDF may take to make. |

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
scripts/              command-line scripts (pnpm seed, pnpm users, pnpm book-pdf)
src/worker.ts         starts a queue worker (pnpm worker), apart from the API
src/jobs/             the job queue (queue.ts), one job try (runJob.ts), providers.ts (which AI runs), story text (storyText.ts)
src/ai/               the AI (BE-10): the one door out (gate.ts), fal/Gemini/Cloudflare clients, prompts, reading the AI's JSON, the real and stub providers
src/print/            the book PDF (BE-18): print profiles (profiles.ts) and the page drawing (renderBook.ts)
src/engine/           the story rules engine (BE-09): plan, context, tables, rules, director; no HTTP or database
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
| `GET /:id/deletion-preview` | What deleting this child removes, what is kept, and whether a printed book is still on its way (BE-16). |
| `POST /:id/deletion` `{ password }` | BE-16: the child is hidden at once (every call → 404), sessions end, and a background job deletes the profile, stories, comments, AI job records and storage files. Kept: audit entries, consent, payment records (without the delivery address). Waits while a paid hardback is printing. Emails the parent when done. Follow it with `GET /api/v1/deletion-requests/:id`. |

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

## Story rules engine (BE-09)

`src/engine/` checks every story the AI writes before it is saved. Plain functions: text in, text out.

```
AI draft (panels; Panels 5 and 9 as the eight beats)
  → engine: repairs (fixed by code, logged)  +  checks (panels to rewrite)
  → the AI rewrites only those panels, at most 2 rounds  (src/jobs/storyText.ts)
  → still broken: the try fails with the reason, and the job queue retries
```

| Rule | Repaired by code | Sent back for a rewrite |
|---|---|---|
| R1 No clinical labels | known word → poetic name ("anxiety" → "the Humming Mist") | words with no safe swap |
| R2 Dream world | | key panels (3, 11, 14) without dream-world words (only when the dream matches the table) |
| R3 Earned, not magic | | "magic", "suddenly", "spell"… in triumph panels |
| R4 Child's Act 3 words | added word for word, in quotes, at the end of Panel 12 | Panel 13 repeating them word for word |
| R5 Inner voice | thoughts put in single quotes | |
| R6 Character + D3 bleed-guard | | hero not named; tools missing; another hero's name, body signal or body part |
| R7 One Brave Sentence | heroWords / heroWords2 added to the Try beat of Panels 5 / 9 | |
| R8 Brave move parity | | a brave move copied from an earlier act |
| R9 Practice Anchor | "One real step today." added | |
| R10 Brave-Step Mandate | "took her/his next brave step toward becoming the [Core Noun]" added | |
| 8-Beat Arc + D4 | | missing, empty or fused beats; the wrong body signal |
| Partial Shift | | "shattered", "vanished", "dissolved", "fixed", "solved", "gone" in resolution beats |
| D5 Panel plan | | a missing or empty panel (extra panels fail the try: never cut or padded) |
| D6 Strategy label | "One Brave Sentence strategy" → "brave words" | |
| D7 Pronoun case | "leaving she" → "leaving her" | |
| D9 Vocabulary garble | | "world-future", "Singer" mid-sentence |
| Two acts | | any third challenge |

The child's own words (heroWords, heroWords2, heroWords3, thirdChallengeText) are never changed or judged.
Every finding is saved on the `story_text` job as a violation (`repaired`, `rewritten` or `failed`) and
shows in Book Progress Detail (`GET /admin/stories/:id/progress`).

`src/engine/director.ts` builds the instructions for the AI from the same plan (used by BE-10).
Tests: `tests/unit/engine/` on fixed samples in `tests/fixtures/engine/` (no AI calls).

## AI generation: story, pictures and title (BE-10)

With `AI_PROVIDER=fal` and a `FAL_KEY`, the real AI makes the story. Tests and PCs without a key use the stub.

```
story_text   director prompt → fal-ai/any-llm → JSON with exactly 12 or 15 panels
             (bad JSON / wrong count → the try fails → the queue retries; after the last try the
              story waits with "Try again" and NO panels are saved: never half-built)
             → BE-09 engine → saved
panel_image  Scene Director (AI) → Visual Brief table → Universal Triumph   (fallback recorded)
             + style (watercolour for Explorer, concept art for Creator) + Character Blueprint
             + dream costume + tools + a fixed seed from hero name and dream
             → FLUX → download → saved in OUR storage as stories/<id>/panel-03.png
title        "[HeroName] and the [Poetic Version of the Dream]"; the formula if the AI's is off
```

| File | What it does |
|---|---|
| `src/ai/gate.ts` | The one door out to every AI: cleans the text (BE-14), time limits, short safe errors, checks pictures are real pictures. |
| `src/ai/falClient.ts` | fal.ai: any-llm text and FLUX pictures (downloads fal.ai's picture link). |
| `src/ai/geminiClient.ts` | Google Gemini: text (free tier) and pictures (paid). |
| `src/ai/cloudflareClient.ts` | Cloudflare Workers AI: Llama text and FLUX schnell pictures (free daily allowance). |
| `src/ai/prompts.ts` | The messages sent to the AI (`PROMPT_VERSION` = `v1`), and hiding the hero's name. |
| `src/ai/storyJson.ts` | Reads the AI's JSON; anything but exactly the planned panels throws (→ retry). |
| `src/ai/realProvider.ts` / `stubProvider.ts` | The real AI (one text client + one picture client) / the fake one, same methods. |
| `src/engine/visual.ts` | Picture rules: styles, Character Blueprints, costumes, Visual Briefs, Universal Triumph, seed, title fallback. |
| `src/lib/storage.ts` | Saves pictures (S3 in the UAE, or `data/storage` on your PC) and makes signed links. |
| `src/routes/media.ts` | Serves local-folder pictures by signed link (your PC only). |

- **Nothing identifying goes to any AI (BE-14).** Every call passes the anonymising gate (`src/ai/anonymise.ts`, `src/ai/gate.ts`): the child's, parent's and author's names, emails, phones, addresses, links and school names are taken out, and the gate refuses to send if any known detail is left. The AI sees the hero's real name, unless it's a family name; then the stand-in "Tibbo". Jobs keep only the cleaned requests (`aiRequests`).
- **Pictures:** the story stores only the key. `GET /api/v1/stories/:id` gives each panel an `imageUrl`, and
  `GET /api/v1/stories/:id/panels/:number/image` gives `{ url, expiresAt }`. Links expire after an hour.
- **Records on every job:** `provider`, `aiModel`, `promptVersion`, `fallbackUsed` (`visual_brief`,
  `universal_triumph`, `title_formula`; the job and panel status is then `fallback`), `durationMs`, `attempts`.
- Tests: `tests/integration/falGeneration.test.ts` runs everything against a fake fal.ai server
  (`tests/helpers/fakeFal.ts`); `tests/unit/ai.test.ts`. No real AI calls, no cost.

To make a real story on your PC: put `AI_PROVIDER=fal` and `FAL_KEY=...` in `.env`, then `pnpm dev` (and `pnpm dev:worker` with Redis).

### Free AI for testing (Gemini + Cloudflare)

The text and the pictures can come from different services (`AI_TEXT_PROVIDER`, `AI_IMAGE_PROVIDER`;
each falls back to `AI_PROVIDER`). The story logic is the same for every mix (`src/ai/realProvider.ts`).

| Text | Pictures | Cost | Notes |
|---|---|---|---|
| `gemini` | `cloudflare` | free | The free mix for testing. |
| `cloudflare` | `cloudflare` | free | One account; Llama follows the story rules less well (more retries). |
| `gemini` | `gemini` | pictures paid | Gemini takes the story's seed, so the hero may look more alike across panels. |
| `fal` | `fal` | paid | What the guide plans for the live app. |
| `stub` | any | free | Placeholder text; the picture scene comes from the Visual Brief table. |

```
AI_TEXT_PROVIDER=gemini
AI_IMAGE_PROVIDER=cloudflare
GEMINI_API_KEY=...            # aistudio.google.com → Get API key
CLOUDFLARE_ACCOUNT_ID=...     # dash.cloudflare.com, account home page
CLOUDFLARE_API_TOKEN=...      # My Profile → API Tokens → "Workers AI" template
```

- **Made-up test children only.** On free plans the service may use what we send. The gate still
  removes names and details, but the live app uses a paid provider (Sami Bhai decides).
- Cloudflare's free allowance is about 10,000 "neurons" a day. By Cloudflare's price list, a 15-panel story
  at 4 steps uses a little under 1,000, so roughly 10 test stories a day. When it runs out, picture jobs fail with
  "answered 429 (rate limit or free allowance used up …)"; use "Try again" the next day.
- Gemini free limits are per model, per day. `gemini-2.5-flash` allows only about 20 requests a day,
  and one story uses about 18 (story, title, a scene per panel). Set `GEMINI_TEXT_MODEL=gemini-3.5-flash-lite`
  for testing. When the limit is hit, scenes fall back to the Visual Brief table (the story still finishes).
- FLUX schnell takes no seed and no size: 1024 squares, cropped to each panel, and the hero can look a little
  different from panel to panel. For print-size pictures in each panel's shape (and the story's seed), set
  `CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-klein-4b` (up to 1920 px; about one comic a day on the free allowance).
- Tests: `tests/integration/freeGeneration.test.ts` against fake servers (`tests/helpers/fakeFreeAi.ts`).

## Comic books (BE-11)

When the child picks **Comic**, the story is written and checked exactly like a storybook (story_text,
the rules engine, the title), and then re-told as a comic:

```
story_text done → one comic_script job per comic page (8 or 10)
                → each page: 4 cells saved → one comic_cell_image job per cell (32 or 40)
                → every job done → child_review
```

| | Two acts | Three acts |
|---|---|---|
| Pages × cells | 8 × 4 = **32** | 10 × 4 = **40** |

- **The beat-to-cell mapping** (which story panels each page tells) is one table, `COMIC_PAGES` in
  `src/engine/comicPlan.ts`. Each brave-move panel gets a whole page (two beats per cell). A two-act comic
  never gets a third-act cell. ⚠️ It's a DRAFT: the guide says Sami Bhai approves it.
- **Built like a real children's comic** (researched: the picture tells the story, very few words, one action
  per panel, a big panel for the big moment, shots that fit the panel, a reason to turn the page).
- **Page layouts** (`LAYOUTS` / `PANEL_SHAPES`, still 4 panels a page): `big_top` (a big wide opening panel +
  3 small), `big_bottom` (3 small + a big one: brave moves and the ending), `tall` (action) and `grid` (calm).
  Each panel's shape decides its camera shot (`wide` / `medium` / `close` / `full`), and the picture prompt
  asks for that shot.
- **Each cell:** a short picture-book line under the panel (`caption`, often empty), optional dialogue with a
  balloon (`speech` oval, `thought` cloud, `whisper` dashed, `shout` spiky), an optional sound effect (`sfx`,
  e.g. "WHOOSH!", drawn by us so it's always spelled right), optional Tempo bubble, the `shot`, the page's
  `layout`, and a `scene` (what the picture shows, never a name).
- **The rules the server enforces** (`tidyCells`): narration ≤ 12 words on at most 2 panels a page; balloons
  short; the story's inner labels ("First Pivot", "brave move"…) never reach the page; one sound effect a page;
  Tempo (the musical squirrel) only on the calm pages (Rest, Practice Anchor), at most once per page, and
  **music notation only** (`cleanTempo`); on a brave-move page the hero's own brave words are always spoken.
  A page where fewer than 2 panels talk is tried again.
- **The AI** writes one page per call (`comicPagePrompt`), through the anonymising gate. If it fails every try,
  the last try uses the **backup splitter** (the page's sentences shared over 4 cells): the job says
  `fallback` / `comic_splitter`, and the comic still finishes.
- **Pictures** have no words in them: the website's book (FE-07, `Flipbook.tsx` + `ComicCell.tsx`) and the PDF
  draw the balloons ON the picture, like a printed comic: top-left (read first), the tail leaning down at the
  hero. Speech, thought and whisper are one solid white oval with a pointed tail; a shout is a spiky burst
  (the shapes: `src/print/balloon.ts`, copied to the website's `src/lib/balloon.ts`). Sound effects and the
  narration line too. The picture prompt is the chosen look as a comic panel + the hero's fixed look + the scene
  (+ Tempo when the cell has him, + calm empty space top-left when the cell has a balloon, `BALLOON_SPACE`).
  Saved as `stories/<id>/cell-NN.<ext>`.
- `GET /stories/:id` gives each cell an `imageUrl`; `GET /stories/:id/status` adds `cells`, and a comic's
  progress counts the cell pictures. "Try again" covers failed cell jobs.
- **The book PDF** of a comic has one page per comic page, in that page's layout (`COMIC_FRAMES` in
  `renderBook.ts`), instead of the panel pages: 14 pages for two acts, 16 for three. On the website a comic
  page fills the open spread (left and right pages); on a phone, one page.
- About **3× the pictures** of a storybook (32–40 instead of 12–15): more fal.ai cost, and the free Cloudflare
  allowance runs out after a couple of comics a day.

## Book PDF and print file (BE-18)

After Stripe says an order is paid, a job on the queue (`src/jobs/bookPdf.ts`) makes the book. It uses
the **same design as the book on the website** (`apps/web/src/components/Flipbook.tsx`): the purple cover,
cream pages, the Fraunces and Nunito fonts, panel names, ornaments and drop capitals. It comes as ordinary
single portrait pages, one after another (8 × 10 in, the website page's 4:5 shape):

| Page | What's on it |
|---|---|
| Cover | Edition, title, "by [authorName]", the date the story was **written** (`storyGeneratedAt`, not the day the PDF was made), the hero |
| Inside cover | "This book belongs to [authorName]" |
| Title page | "A Dream Builder Story", title, the hero in a circle, "Written by" |
| Today's Mission | The child's dream (`aspiration`) and `oneMoreAmazingThing` |
| The story | Each panel opens a page: picture, panel name, text. A long text carries on overleaf, like the website. 12 panels for two_act (never an Act 3 panel), 15 for three_act |
| The End | The hero resting, "Thank you for reading …" |
| Back cover | Title, author and year, "Made with Dream Builder". The space for the voice QR is kept free (BE-15 later) |

With short panel texts a two-act book is 18 pages and a three-act book 21. A missing picture, or the stub
AI's 1×1 placeholder, shows the hero on a soft sky instead (as the website does), with a warning on the order.
The fonts (SIL Open Font License) and the hero art are in `apps/api/assets/`.

Every paid order gets the parent's PDF
(`DOWNLOAD_PROFILE`, no bleed); a hardback also gets the printer's file (`PRINT_PROFILE`, with
bleed and TrimBox) and its `printStatus` moves `waiting → file_ready` for BE-19. Both files are in
`stories/<storyId>/print/`, so a BE-16 deletion removes them (the order record stays, `pdfStatus: deleted`).

- `GET /api/v1/orders/:id/download` gives a short-lived link: the paying parent only (anyone else 404),
  `409 NOT_PAID` before payment, `409 PDF_NOT_READY` while it's being made. Each one writes an audit entry.
- The order shows `pdfStatus`: `not_started → queued → making → ready` (or `failed` after the retries).
- Admin can make one again: `pnpm book-pdf <order id or DB-123456> [--save copy.pdf]`.
- A new publisher = a new entry in `src/print/profiles.ts` + `PRINT_PROFILE=<id>`. A profile holds trim size,
  bleed, safe margin, minimum dpi, colour and a page-count multiple (filled with "My drawing" pages, never blanks).
- Pictures below the profile's dpi are not refused: the order gets `pdfWarnings` for admin.

## Known gaps

| Gap | Story | Notes |
|---|---|---|
| Google and Apple sign-in | BE-03 | Left for later (Sami Bhai's decision to make). Apple also waits for Dina's Apple developer account. |
| Real email sending | AWS-01 | Until Sami Bhai sets up email from Dina's domain, production only logs "email NOT sent". |
| Two-act panel plan | BE-09 | Panels 1–10 + Grand Finale + Practice Anchor (pages 11–13 dropped). Decided by Anas; Sami Bhai to check it matches the prototype. |
| Eight beats in Panels 5 and **9** | BE-09 | The guide says "5 and 8"; read as 9 (the second brave move). Waiting for Sami Bhai. |
| Core Noun rule | BE-09 | "be a vet" → "vet"; an action uses the dream-world noun; otherwise "dreamer". Waiting for Sami Bhai. |
| Engine word tables are starters | BE-09 | Clinical words and dream worlds in `src/engine/tables.ts`; swap in the prototype's tables when they arrive. |
| Text model not confirmed | BE-10 | The PRD's Gemini Flash 1.5 is retired; `FAL_TEXT_MODEL` defaults to `google/gemini-2.5-flash`. Sami Bhai picks. |
| Our own prompts (v1) | BE-10 | Written from the director and the PRD. Replace with the prototype's prompts (v2) if Sami Bhai sends them. |
| Picture tables are starters | BE-10 | Blueprints, costumes, Visual Briefs and poetic dream names in `src/engine/visual.ts`. |
| The UAE bucket | AWS-01 | Sami Bhai creates it; production refuses to start without `S3_BUCKET`. Until then pictures go to `data/storage`. |
| Review of 3 real stories | BE-10 | Sami Bhai checks the hero keeps the same look, name and pronoun across panels. Needs a fal.ai key. |
| "Marked failed" after the last try | BE-07 / BE-10 | The story waits in `generating` with the failed job and "Try again" (no `failed` story status in the guide's lifecycle). |
| Comic mapping not approved | BE-11 | The page→panel table in `src/engine/comicPlan.ts` is a draft. Sami Bhai approves it (PRD F7); changing it is a table edit. Also to confirm: 2 Comic Vibes in the PRD vs 3 on the website, and when Tempo appears. |
| Editing and redrawing comic cells on the website | BE-12 / FE-07 | The server can edit a cell's words (`PATCH /stories/:id/comic-cells/:page/:cell`); the website viewer is read-only for now, and there's no cell redraw yet. |
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
| Pictures are below 300 dpi for print | BE-18 | AI pictures are ~1024 px; a full 21 cm page needs ~2500 px. The PDF is made with a warning. Sami Bhai decides: upscale, bigger AI pictures, or smaller pictures on the page. |
| Voice QR on the back cover | BE-15 / BE-18 | Skipped for now (Anas's decision); the space is kept free. |
| Non-Latin text in the PDF | BE-18 | The PDF fonts (Fraunces, Nunito) carry Latin letters only: Arabic letters won't show. Add an Arabic font if stories can contain them. |
| CMYK and the publisher's spec | BE-18 / BE-19 | The `generic` profile is RGB, 8 × 10 in portrait. Replace it when the publisher's spec arrives. |
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
