import { Router } from "express";
import { allow } from "../middleware/access.js";
import * as deletion from "../services/deletion.js";

// Deletion requests (guide BE-16). Mounted at /api/v1/deletion-requests.
//   GET /:id   the parent's own request: queued / waiting_for_print / running / done / failed
export function createDeletionRequestsRouter(): Router {
  const router = Router();

  router.get("/:id", allow("verified_parent"), async (req, res) => {
    res.json({ request: await deletion.getDeletionRequest(req.user!.id, String(req.params.id)) });
    return;
  });

  return router;
}
