import { Router } from "express";
import { z } from "zod";
import { createAuthRateLimits } from "../middleware/rateLimits.js";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import { exitWithPassword, handOver } from "../services/childSessions.js";
import { readRefreshCookie } from "../services/sessions.js";

// Child sessions (guide BE-04). Mounted at /api/v1/auth/child-session.
//
// Why under /auth? The refresh cookie is only sent to /api/v1/auth/... paths. Both routes
// here must SWAP that cookie (parent → child, child → parent), so they have to live there.

// Not checked as an id here: a bad id gets the same 404 as someone else's child.
const startSchema = z.object({ childId: z.string().min(1).max(100) }).strict();
const exitSchema = z.object({ password: z.string().min(1).max(1000) }).strict();

export function createChildSessionRouter(): Router {
  const router = Router();
  const limits = createAuthRateLimits();

  // POST /api/v1/auth/child-session  { childId }  (parent wristband)
  // "Hand Device & Begin": the parent session on this device ends, a child session starts.
  router.post("/", allow("verified_parent"), validate(startSchema), async (req, res) => {
    const body = await handOver(res, req.user!.id, req.body.childId, readRefreshCookie(req), req.ip);
    res.status(201).json(body);
    return;
  });

  // POST /api/v1/auth/child-session/exit  { password }  (kids' wristband)
  // Right parent password → the child session ends and a fresh parent session starts.
  router.post("/exit", allow("child_session"), limits.childExit, validate(exitSchema), async (req, res) => {
    const body = await exitWithPassword(res, req.childSession!, req.body.password, req.ip);
    res.json(body);
    return;
  });

  return router;
}
