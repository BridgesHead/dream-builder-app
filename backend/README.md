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
scripts/              command-line scripts (pnpm seed)
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

Login, register and refresh return `{ user, accessToken, expiresIn }`. Send the access token as
`Authorization: Bearer <accessToken>`; it lasts 15 minutes. The refresh token is only ever in the
`db_refresh` cookie (httpOnly, SameSite=Strict, Secure outside development, path `/api/v1/auth`).

**Emails on your PC** are not really sent: the dev mailer prints them in the terminal running
`pnpm dev`. Copy the link from there.

Error codes: `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `WEAK_PASSWORD`, `SESSION_EXPIRED`, `UNAUTHENTICATED`,
`CONSENT_REQUIRED`, `EMAIL_NOT_VERIFIED`, `LINK_INVALID`, `LINK_USED`, `LINK_EXPIRED`, `TOO_MANY_ATTEMPTS`.

Rate limits: 10 failed logins per email in 15 minutes; 5 sign-ups, and 5 forgot-password or resend
emails, per IP address per hour.

## Known gaps

| Gap | Story | Notes |
|---|---|---|
| Google and Apple sign-in | BE-03 | Left for later (Sami Bhai's decision to make). Apple also waits for Dina's Apple developer account. |
| Real email sending | AWS-01 | Until Sami Bhai sets up email from Dina's domain, production only logs "email NOT sent". |
| Rate-limit counts are in memory | BE-07 | Each server counts on its own and a restart resets them. Move them to Redis when BE-07 adds it. |
| Refresh-token rotation | BE-23 | The guide schedules rotation for BE-23. |
| A failed generation has no way back from `generating` | BE-10 | Open question for Sami Bhai (see `docs/data-model.md`). |

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
