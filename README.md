# Dream Builder

Dream Builder is an interactive, child-centred story creation experience. It guides a child and their parent through choosing a story format and visual style, creating a hero, exploring challenges and feelings, and producing a personalised storybook.

## Repo layout (monorepo)

All apps and shared code live in this one repo. pnpm installs everything from the root, and
[Turborepo](https://turborepo.dev) runs each task for every app in the right order.

```text
apps/
  web/              Frontend: React 18 + Vite + Tailwind (the parent and child screens)
  api/              Backend: Express 5 + MongoDB. Two programs from one codebase:
                    the API (pnpm start) and the job worker (pnpm worker)
packages/
  api-contracts/    openapi.yaml: every API route, its inputs and answers (the source of truth)
  api-types/        TypeScript types generated from openapi.yaml, used by web
  config/           Shared TypeScript and ESLint settings
infra/              AWS setup (AWS-01 to AWS-04), owned by Sami Bhai
turbo.json          Which task depends on which (for example: typecheck needs api-types built first)
pnpm-workspace.yaml Lists the apps and packages that make up the repo
```

This is a monorepo, not microservices: the backend is still one API plus one worker, as the
backend guide plans. The code inside `apps/api` is split by area (auth, stories, orders, ...), so a
part can move into its own service later if it ever needs to scale on its own.

## Run locally

You need Node.js 24 (see `.nvmrc`), pnpm 12 and MongoDB (see `apps/api/README.md`).

```bash
pnpm install                   # once, from the repo root: installs every app and package
cp apps/api/.env.example apps/api/.env   # then edit it
pnpm dev                       # starts the API (port 3000) and the frontend (port 5173) together
```

Open <http://localhost:5173>. Vite forwards `/api/...` requests to the API, so no CORS is needed.

## Useful commands (from the root)

```bash
pnpm typecheck                 # TypeScript, every app
pnpm lint                      # ESLint
pnpm test                      # all tests (the API's need MongoDB running)
pnpm build                     # builds the shared packages and the frontend
pnpm contracts                 # re-generates api-types after editing openapi.yaml
pnpm --filter @dream-builder/api seed    # run one app's own script
```

## More docs

- `apps/api/README.md`: backend setup, every environment variable, known gaps
- `apps/api/docs/backend-guide.txt`: the user stories (BE-01 to BE-27, AWS-01 to AWS-04)
- `TESTING.md`: walking through the app with the test account
- Visit `/screens` in the running frontend to open any screen directly

## Asset attribution

The generated artwork is documented in `Dream-Builder-Generated-Art/README.txt`.
