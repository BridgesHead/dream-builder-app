import type { RequestHandler } from "express";
import { Consent, User } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { checkAccessToken } from "../services/accessTokens.js";
import { toPublicUser } from "../services/users.js";

// The door guards. Put one in front of a route:
//   router.get("/me", requireParent, handler)
//   router.post("/children", requireVerifiedParent, handler)   (BE-04)

// Reads "Authorization: Bearer <access token>", checks it, loads the user, sets req.user.
export const requireParent: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please log in");

  const check = await checkAccessToken(token);
  if (!check.ok) {
    if (check.reason === "expired") throw new AppError(401, "SESSION_EXPIRED", "Your session has expired");
    throw new AppError(401, "UNAUTHENTICATED", "Please log in");
  }

  // Load the user fresh, so a deleted account stops working straight away.
  const user = await User.findById(check.userId).lean();
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please log in");
  if (user.role !== "parent") throw new AppError(403, "FORBIDDEN", "This is for parent accounts");

  req.user = toPublicUser(user);
  next();
};

// requireParent, plus the BE-03 rule: a parent can't create child profiles until their email
// is verified AND their consent is recorded.
const verifiedAndConsented: RequestHandler = async (req, _res, next) => {
  const user = req.user!;
  if (!user.emailVerified) {
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Please confirm your email address first");
  }
  if (!(await Consent.exists({ parentId: user.id }))) {
    throw new AppError(403, "CONSENT_REQUIRED", "Parental consent is needed first");
  }
  next();
};

export const requireVerifiedParent: RequestHandler[] = [requireParent, verifiedAndConsented];
