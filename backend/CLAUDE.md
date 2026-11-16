# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Dream Builder API (server/)

> Note: on disk this package is the `backend/` directory. Everywhere below, "server/" means `backend/`.

Backend for Dream Builder, a storytelling app for children aged 8–14.
I am a beginner at backend. After writing code, briefly explain what each new file does and why.

## Source of truth: the backend guide
`docs/backend-guide.txt` holds the user stories (BE-01 … BE-27, AWS-01 … AWS-04) with their Build lists and
acceptance criteria. **Follow the guide.** Where this file, the PRD or the old code disagree with it, the guide wins.
Work story by story in the guide's order and check each acceptance criterion before calling a story done.
Refer to the project lead as "Sami Bhai".

## Stack (from the guide; do not change without asking)
- Node.js 24 + TypeScript, ES modules ("type": "module")
- Express 5, every route under /api/v1
- MongoDB + Mongoose (Atlas in the AWS UAE region on dev/staging/prod; a local MongoDB for development)
- Zod for all request validation
- Passwords hashed with argon2 or bcrypt (not scrypt)
- Auth: short-lived access token + refresh token in an httpOnly, secure cookie
- Structured JSON logs; one shared error shape
- Background jobs: a real queue with workers running apart from the API (library to confirm with Sami Bhai; BullMQ + Redis is the likely choice)
- CI on every PR: lint, unit tests, integration tests against a test database, secret scanner
- pnpm with --ignore-workspace for every install

> The code from before the guide (PGlite + Drizzle, scrypt, "sid" DB sessions, `final` status) is being
> replaced story by story. Don't build new features on it.

## Commands

```bash
pnpm install --ignore-workspace --lockfile-dir .
pnpm add <pkg> --ignore-workspace --lockfile-dir .
pnpm --ignore-workspace dev         # tsx watch src/index.ts
pnpm --ignore-workspace typecheck   # tsc --noEmit
```

pnpm 12 gotchas:
- `backend/` now has its own `pnpm-workspace.yaml`, so pnpm treats it as its own project and the parent folder (frontend) is not mixed in. Plain `pnpm install` / `pnpm dev` work, and so does the `--ignore-workspace` style above. CI uses plain `pnpm install --frozen-lockfile`.
- `--ignore-workspace` also ignores backend/pnpm-workspace.yaml, so its `allowBuilds` list is NOT read in that mode. In strict CI mode that made the install fail with `ERR_PNPM_IGNORED_BUILDS`.
- Build scripts are blocked unless listed under `allowBuilds` in `backend/pnpm-workspace.yaml` (esbuild and argon2 are). Approve a new one with `pnpm approve-builds <pkg>`.
- If a stray nested `backend/backend/node_modules` ever shows up, delete it.
- TypeScript is pinned to 6.0: typescript-eslint does not support TS 7 yet.

## Folder layout
src/index.ts          only starts the server
src/app.ts            builds the Express app, mounts routes under /api/v1
src/config.ts         reads env vars (secrets from env or the AWS secret store, never the repo)
src/db/               connection + Mongoose models
src/routes/           one Router per area
src/middleware/       validate, auth/access checks, errorHandler
src/services/         real logic; routes stay thin
src/engine/           story director + enforcers, no HTTP or database code (BE-09)
src/jobs/             queue + workers
src/lib/              small helpers
src/types/            shared types (StoryState etc.)
docs/                 the guide, data model note, setup notes

## Rules
- All routes under /api/v1.
- Validate every request body with Zod via a shared validate middleware.
- Never trust the client for ownership: parentId always comes from the authenticated user, never from the body.
- Anything not owned by the caller returns 404 (not 403), so we don't reveal it exists. A role that may see something but not change it (e.g. a facilitator) gets 403.
- Check ID params before querying; bad IDs return 404, not 500.
- Never return or log passwords, password hashes, tokens or other secrets.
- In handlers, send the response then `return;` (don't `return res.json(...)`).
- One errorHandler middleware, registered last; it logs the error and returns the shared error shape.
- Story lifecycle: draft → generating → child_review → parent_review → approved, and parent_review can send it back to child_review. One shared function allows or refuses each change.
- Do not touch files outside server/ unless I ask.
- Do not run git commands unless I ask.

## Frontend contract (../src/state/AppState.tsx)
- Read the frontend's `StoryState`, `ChildProfile`, `ParentState` and `Order` for field names; don't guess. Stories also hold the fields the guide adds (e.g. `storyPath` two_act/three_act, `oneMoreAmazingThing`, `thirdChallengeText`).
- Mode defaults from the child's age: under 12 is Explorer (`junior`), 12 and over is Creator (`senior`). The parent's choice is what gets stored.
- `heroPronoun` accepts only `he` or `she`.
- The hero name falls back in this order: `charName`, then the hero type's `defaultName` (in `../src/data/content.ts`), then `"Sparky"`.
- `facesChallenge3`: `null` means not decided yet, and `false` means the child skipped the Challenge Gate.
- Panels: 12 for two_act, 15 for three_act. Images are AI-generated and stored in our bucket, never fal.ai links.
