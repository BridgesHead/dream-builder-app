import { Router } from "express";
import { z } from "zod";
import { User } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { createAuthRateLimits } from "../middleware/rateLimits.js";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import * as auth from "../services/auth.js";
import { parentSessionBody, refreshChildSession } from "../services/childSessions.js";
import {
  checkSession,
  clearRefreshCookie,
  endSession,
  endSessionById,
  readRefreshCookie,
  startSession,
} from "../services/sessions.js";
import { toPublicUser } from "../services/users.js";

// Trim spaces and lowercase, so " Ana@X.com " and "ana@x.com" are the same account.
const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Only a size limit here. The real password rule (WEAK_PASSWORD) is in the auth service.
const passwordField = z.string().max(1000);
const linkToken = z.string().min(1).max(200);

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailField,
  password: passwordField,
  // Booleans, not "must be true": refusing them gives the clearer CONSENT_REQUIRED code.
  adultConfirmed: z.boolean(),
  consent: z.boolean(),
});
const loginSchema = z.object({ email: emailField, password: passwordField.min(1), remember: z.boolean().default(false) });
const tokenSchema = z.object({ token: linkToken });
const emailSchema = z.object({ email: emailField });
const resetSchema = z.object({ token: linkToken, password: passwordField });

// What login, register and refresh send back: { kind: "parent", user, accessToken, expiresIn }.
// The refresh token is NOT here: it only travels in the httpOnly cookie.
const sessionBody = parentSessionBody;

export function createAuthRouter(): Router {
  const router = Router();
  const limits = createAuthRateLimits();

  // POST /api/v1/auth/register
  router.post("/register", allow("public"), limits.register, validate(registerSchema), async (req, res) => {
    const user = await auth.register(req.body, req.ip ?? "unknown");
    // A new parent is logged in straight away (and remembered), but can't add children
    // until they verify their email.
    await startSession(res, user.id, true);
    res.status(201).json(await sessionBody(user));
    return;
  });

  // POST /api/v1/auth/login
  router.post("/login", allow("public"), limits.login, validate(loginSchema), async (req, res) => {
    const { email, password, remember } = req.body as z.infer<typeof loginSchema>;
    const user = await auth.login(email, password, req.ip);
    await startSession(res, user.id, remember);
    res.json(await sessionBody(user));
    return;
  });

  // POST /api/v1/auth/refresh: the access token ran out; use the refresh cookie for a new one.
  router.post("/refresh", allow("public"), async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please log in");

    const check = await checkSession(token);
    if (!check.ok) {
      clearRefreshCookie(res);
      if (check.reason === "expired") throw new AppError(401, "SESSION_EXPIRED", "Your session has expired. Please log in again.");
      throw new AppError(401, "UNAUTHENTICATED", "Please log in");
    }

    // A child session (BE-04) gets a new kids' wristband, never a parent one.
    if (check.childId) {
      const body = await refreshChildSession(check.userId, check.childId, check.sessionId);
      if (!body) {
        // The child was removed meanwhile.
        await endSessionById(check.sessionId);
        clearRefreshCookie(res);
        throw new AppError(401, "UNAUTHENTICATED", "This story session has ended");
      }
      res.json(body);
      return;
    }

    const user = await User.findById(check.userId).lean();
    if (!user) {
      clearRefreshCookie(res);
      throw new AppError(401, "UNAUTHENTICATED", "Please log in");
    }
    res.json(await sessionBody(toPublicUser(user)));
    return;
  });

  // POST /api/v1/auth/logout: works even when already logged out, so it's always safe to call.
  router.post("/logout", allow("public"), async (req, res) => {
    const token = readRefreshCookie(req);
    if (token) await endSession(token);
    clearRefreshCookie(res);
    res.status(204).end();
    return;
  });

  // POST /api/v1/auth/verify-email  { token } from the link in the email
  router.post("/verify-email", allow("public"), validate(tokenSchema), async (req, res) => {
    await auth.verifyEmail(req.body.token);
    res.status(204).end();
    return;
  });

  // POST /api/v1/auth/resend-verification (logged in)
  router.post("/resend-verification", allow("parent"), limits.email, async (req, res) => {
    await auth.resendVerification(req.user!.id);
    res.status(204).end();
    return;
  });

  // POST /api/v1/auth/forgot-password  { email }: the same answer whether or not the email exists.
  router.post("/forgot-password", allow("public"), limits.email, validate(emailSchema), async (req, res) => {
    await auth.forgotPassword(req.body.email);
    res.status(204).end();
    return;
  });

  // POST /api/v1/auth/reset-password  { token, password }
  router.post("/reset-password", allow("public"), validate(resetSchema), async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.status(204).end();
    return;
  });

  // GET /api/v1/auth/me: who is logged in? (any grown-up; a child session can't ask)
  router.get("/me", allow("parent", "facilitator", "admin"), (req, res) => {
    res.json({ user: req.user });
    return;
  });

  return router;
}
