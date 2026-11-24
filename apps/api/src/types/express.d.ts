import type { PublicUser } from "../services/users.js";

// Teach TypeScript that an Express request can carry who is calling.
// Express's types look for extra request fields in a global "Express" namespace.
declare global {
  namespace Express {
    interface Request {
      // Set by allow(...) (src/middleware/access.ts): the logged-in grown-up (parent, facilitator, admin).
      user?: PublicUser;
      // Set by allow("child_session"): a child using the parent's device (BE-04).
      childSession?: { sessionId: string; childId: string; parentId: string };
    }
  }
}

export {};
