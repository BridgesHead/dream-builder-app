# Walking through Dream Builder

**Accounts are real now** (backend story BE-03): sign-up, login, email
verification and password reset use the API and are saved in MongoDB. Child
profiles, stories and orders are still kept only in the browser's localStorage
until their backend stories (BE-04, BE-08, BE-17) are built.

## Start both servers

1. MongoDB running (see `apps/api/README.md`)
2. From the repo root, run `pnpm dev`: it starts the API (port 3000) and the frontend
   (port 5173; the frontend forwards `/api` to the API)

## Test account

`pnpm --filter @dream-builder/api seed` creates this parent (verified, with consent recorded).
It empties the local database first.

| Field     | Value              |
| --------- | ------------------ |
| Full name | Sarah Jenkins      |
| Email     | parent@example.com |
| Password  | DreamTest123       |

Or sign up with your own details: a password needs 8+ characters with a letter
and a number. Tick both consent boxes.

**Emails aren't really sent on your PC.** The verification and password-reset
emails are printed in the terminal running the backend. Copy the link from
there into the browser. Each link works once, for 24 hours.

## Full journey, in order

Start fresh first: open the site in a private/incognito window, or click
**Sign out** on any parent page. If a "Preview mode" badge shows bottom-left,
click **Exit**.

1. `http://localhost:5173/` → **Create your account** → **Check your inbox**:
   open the link from the backend terminal to confirm the email
2. **Child profile configuration** → **Add Child**
   - Explorer flow: name `Alex`, age `8`
   - Creator flow: name `Maya`, age `14`
3. Select the child → **Ready for Handover** → **Hand Device & Begin**
4. **Start a New Story** → author name → format → art style
5. Hero → (Explorer: name + pronoun) → strength → (Explorer: helpful tools) → dream
6. Act 1: obstacle → feeling → brave move (Creator: one combined screen)
7. Rest & Restore → Act 2 → Challenge Gate
8. **Help Pip face it** (final act) or **Continue to the Ending**
9. Generating → cover → book reader → on the last page (15/15) **I'm Done!** → **Ask a Parent to Continue**
10. Parent review → **Confirm Story** → plans → payment (any card details) → order confirmation

To see the other mode, go to **Back to Child Profiles**, select the other child
and hand over again.

## Jump to any screen

`http://localhost:5173/screens` — load the Explorer or Creator demo, then open
any screen directly.

## Artwork

Images live in `frontend/src/assets/`, named by what they show (for example
`obstacles/roaring-fire.webp` or `heroes/knight/rest.webp`). Any slot without a
file shows a dashed placeholder; hero poses that are missing fall back to that
hero's standing image.

`http://localhost:5173/screens/assets` lists every expected file with ✅ / ❌.
To add one, save it under the listed path (WebP preferred, ideally under
~200 KB) — no code changes needed.
