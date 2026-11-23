import type { Request, RequestHandler } from "express";
import { Child, Consent, User } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { checkAccessToken } from "../services/accessTokens.js";
import { childSessionIsOpen } from "../services/sessions.js";
import { toPublicUser } from "../services/users.js";

// THE access check (guide BE-05). Every route starts with exactly one allow(...) that says
// who may call it:
//
//   router.post("/login", allow("public"), ...)                     anyone
//   router.get("/me", allow("parent", "facilitator", "admin"), ...)  any grown-up
//   router.post("/", allow("verified_parent"), ...)                 verified parent with consent
//   router.post("/exit", allow("child_session"), ...)               a child on the parent's device
//   router.get("/audit-log", allow("admin"), ...)                    admin only
//
// The access-matrix test (tests/integration/accessMatrix.test.ts) fails if any route is
// missing its allow(...), so no route can ship without an explicit rule.

export const WHO = ["public", "parent", "verified_parent", "child_session", "facilitator", "admin"] as const;
export type Who = (typeof WHO)[number];

// A hidden label on each allow() middleware, so the test can find the rule of every route.
const RULE = Symbol("accessRule");
export function accessRuleOf(handler: unknown): readonly Who[] | undefined {
  return (handler as { [RULE]?: readonly Who[] } | undefined)?.[RULE];
}

// Reads "Authorization: Bearer <access token>" and checks it.
async function readAccessToken(req: Request) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please log in");

  const check = await checkAccessToken(token);
  if (!check.ok) {
    if (check.reason === "expired") throw new AppError(401, "SESSION_EXPIRED", "Your session has expired");
    throw new AppError(401, "UNAUTHENTICATED", "Please log in");
  }
  return check;
}

const forbidden = (message = "You don't have access to this") => new AppError(403, "FORBIDDEN", message);

export function allow(...who: Who[]): RequestHandler {
  const handler: RequestHandler = async (req, _res, next) => {
    if (who.includes("public")) {
      next();
      return;
    }

    const check = await readAccessToken(req);

    // A kids' wristband (BE-04).
    if (check.role === "child_session") {
      if (!who.includes("child_session")) throw forbidden("Please ask a parent to do this");
      // The session must still be open, and the child still there and still this parent's.
      const open = await childSessionIsOpen(check.sessionId!, check.childId!);
      const child = open && (await Child.exists({ _id: check.childId, parentId: check.userId, deletedAt: null }));
      if (!child) throw new AppError(401, "UNAUTHENTICATED", "This story session has ended");
      req.childSession = { sessionId: check.sessionId!, childId: check.childId!, parentId: check.userId };
      next();
      return;
    }

    // A grown-up's wristband. Load the user fresh, so a deleted account stops at once.
    const user = await User.findById(check.userId).lean();
    if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please log in");
    // The role changed since this token was made (e.g. by the admin script): log in again.
    if (user.role !== check.role) throw new AppError(401, "UNAUTHENTICATED", "Please log in again");

    if (user.role === "parent" && !who.includes("parent")) {
      if (!who.includes("verified_parent")) throw forbidden();
      // BE-03: no child profiles until the email is verified AND consent is recorded.
      if (!user.emailVerifiedAt) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Please confirm your email address first");
      if (!(await Consent.exists({ parentId: user._id }))) {
        throw new AppError(403, "CONSENT_REQUIRED", "Parental consent is needed first");
      }
    } else if (user.role !== "parent" && !who.includes(user.role)) {
      throw forbidden();
    }

    req.user = toPublicUser(user);
    next();
  };
  Object.defineProperty(handler, RULE, { value: Object.freeze([...who]) });
  return handler;
}

// For routes about one child's things (BE-08 stories): a child session may only reach its
// OWN child. Anything else is "not found", so it can't even tell another child exists.
export function assertOwnChild(req: Request, childId: string): void {
  if (req.childSession?.childId !== childId) throw new AppError(404, "NOT_FOUND", "Not found");
}
