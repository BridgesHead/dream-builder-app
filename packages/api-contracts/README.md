# @dream-builder/api-contracts

`openapi.yaml` describes every route of the Dream Builder API: its URL, who may call it
(`x-roles`), what it takes and what it answers. It is the **source of truth** for the API.

- `packages/api-types` turns it into TypeScript types for the frontend (`pnpm contracts` from the root).
- A test in `apps/api` (`tests/unit/openapi.test.ts`) fails if the app has a route this file
  doesn't list, or this file lists a route the app doesn't have.

When you add or change a route:

1. Change the route in `apps/api/src/routes/`.
2. Change it here.
3. Run `pnpm contracts`, then `pnpm typecheck` from the root: the frontend shows a red error
   anywhere it no longer matches.

The guide (BE-13, BE-20, BE-27) requires this file to match what is deployed.
