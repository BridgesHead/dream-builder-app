import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { allow } from "../middleware/access.js";
import { listAudit } from "../services/audit.js";
import { adminViewStory } from "../services/storyViews.js";

// Admin routes (guide BE-05). Mounted at /api/v1/admin. Admin accounts are made only by the
// command-line script (scripts/users.ts), never through sign-up.
//
// The audit log can only be READ here. There is deliberately no route that changes or
// deletes an entry (and the model refuses it anyway).

const auditQuery = z
  .object({
    actorId: z.string().max(100).optional(),
    targetType: z.string().max(50).optional(),
    targetId: z.string().max(100).optional(),
    action: z.string().max(100).optional(),
    before: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export function createAdminRouter(): Router {
  const router = Router();
  const adminOnly = allow("admin");

  // GET /api/v1/admin/audit-log?targetType=child&targetId=...&limit=50&before=<entry id>
  router.get("/audit-log", adminOnly, async (req, res) => {
    // Query strings are checked here (the validate middleware checks bodies).
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", z.flattenError(parsed.error).fieldErrors);
    }
    res.json({ entries: await listAudit(parsed.data) });
    return;
  });

  // GET /api/v1/admin/stories/:storyId: open any story (written to the audit log).
  router.get("/stories/:storyId", adminOnly, async (req, res) => {
    res.json({ story: await adminViewStory(req.user!.id, String(req.params.storyId), req.ip) });
    return;
  });

  return router;
}
