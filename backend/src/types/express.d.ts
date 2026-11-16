import type { PublicUser } from "../services/users.js";

// Teach TypeScript that an Express request can carry the logged-in user.
// requireParent (src/middleware/requireAuth.ts) sets it; handlers after it can read req.user.
// Express's types look for extra request fields in a global "Express" namespace.
declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
