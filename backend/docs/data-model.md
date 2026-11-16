# Data model (BE-02)

MongoDB, through Mongoose. The schemas live in `src/db/models/`. Every top-level document has an
`_id` (sent to the frontend as `id`), plus `createdAt` and (except append-only ones) `updatedAt`.
Every schema refuses missing required fields, values outside its lists, and unknown fields.

## How the collections connect

```
users (parent) ──< consents
   ├──< sessions, emailLinks
   │
   └──< children ──< stories ──< comments
                        │  (panels and comicCells live INSIDE each story)
                        └──< jobs

auditLogs: points at any record through targetType + targetId
```

`──<` means "one to many": one parent has many children, one story has many jobs.
A story's parent is found through its child (`story.childId` → `child.parentId`).

## Collections

| Collection | What it holds | Key fields | Indexes |
|---|---|---|---|
| `users` | Grown-up accounts | `email` (unique, lowercase), `name`, `passwordHash` (argon2; hidden from queries and JSON), `role` (`parent` / `facilitator` / `admin`), `emailVerifiedAt` | `email` unique |
| `consents` | A parent's recorded consent. **Append-only:** a new text version adds a record | `parentId`, `textVersion`, `method` (`email_verification`), `ipAddress`, `createdAt` | `parentId` |
| `children` | Child profiles | `parentId`, `name`, `age` (8–14, whole years), `language`, `mode` (`junior` / `senior`; defaults from age, the parent's choice is stored), `deletedAt` (soft delete) | `parentId` |
| `stories` | One document per story | `childId`, `status`, `mode`, `storyPath` (`two_act` / `three_act` / null), `title`, every frontend `StoryState` field, `oneMoreAmazingThing`, `thirdChallengeText`, `panels[]`, `comicCells[]` | `childId` + `updatedAt`, `status` |
| `comments` | Parent comments and change requests, kept apart from the child's text | `storyId`, `panelNumber` (null = whole story), `authorId`, `type` (`comment` / `change_request`), `text` | `storyId` |
| `jobs` | Background work | `storyId`, `type` (`story_text`, `panel_image`, `comic_script`, `comic_cell_image`, `title`, `panel_redraw`), `status`, `panelNumber`, `cellNumber`, `provider`, `aiModel`, `durationMs`, `attempts`, `error`, `violations[]` | `storyId` + `createdAt` |
| `auditLogs` | Security diary. **Append-only.** No story text or secrets | `actorId`, `actorRole`, `action`, `targetType`, `targetId`, `ipAddress`, `createdAt` | `targetType` + `targetId` + `createdAt`, `actorId` + `createdAt` |
| `sessions` (BE-03) | One login on one device: the server side of a refresh token | `userId`, `tokenHash` (SHA-256 of the cookie's token, never the token), `expiresAt` (30 days with "remember me", else 1 day), `remember` | `userId`, `tokenHash` unique, `expiresAt` TTL (MongoDB deletes expired sessions) |
| `emailLinks` (BE-03) | Single-use links sent by email | `userId`, `purpose` (`verify_email` / `reset_password`), `tokenHash`, `expiresAt` (24 hours), `usedAt` | `userId`, `tokenHash` unique, `expiresAt` TTL (deleted 7 days after expiry) |

### Inside a story

- `panels[]`: `number` (1–15, unique in the story), `text`, `previousTexts[]`, `imageKey`, `textStatus`, `imageStatus`.
  12 panels for `two_act`, 15 for `three_act`.
- `comicCells[]`: `page` (1–10), `cell` (1–4), `caption`, `dialogue`, `bubbleType` (`thought` / `speech` / `none`),
  `tempo`, `imageKey`, `imageStatus`. 32 cells for two acts, 40 for three.
- `imageKey` is a key in our bucket, never a web link (so never a fal.ai URL).
- `textStatus`, `imageStatus` and job `status` use: `queued`, `running`, `success`, `fallback`, `failed`.

## Story lifecycle

```
draft ──► generating ──► child_review ──► parent_review ──► approved
                              ▲                 │
                              └─────────────────┘
```

Only these five changes are allowed. `src/services/storyLifecycle.ts` is the one function that
allows or refuses a change; everything that changes a status must use it.
Open question for Sami Bhai: should a failed generation be allowed to go back (`generating → draft`)?

## Append-only collections

`auditLogs` and `consents` refuse every update and delete made through Mongoose
(`updateOne`, `deleteMany`, `doc.save()` on an existing record, ...). Records can only be added.

## Seed data

`pnpm seed` empties the local database and creates the Sprint 1 fixtures: the parent
Sarah Jenkins (`parent@example.com` / `DreamTest123`, verified, with a consent record),
the children Alex (8, junior) and Maya (14, senior), and one complete three-act draft each.
It refuses to run when `NODE_ENV` is `production`.
