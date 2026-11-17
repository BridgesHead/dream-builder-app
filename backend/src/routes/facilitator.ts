import { Router } from "express";
import { allow } from "../middleware/access.js";
import { facilitatorChildren, facilitatorStoryHistory, facilitatorViewStory } from "../services/storyViews.js";

// The facilitator portal (guide BE-05, FE-14). Mounted at /api/v1/facilitator.
// READ ONLY: there are only GET routes here. A facilitator calling any route that changes
// something (children, stories, approvals ...) gets 403 from that route's allow(...).

export function createFacilitatorRouter(): Router {
  const router = Router();
  const facilitatorOnly = allow("facilitator");

  // GET /api/v1/facilitator/children: the children linked to me.
  router.get("/children", facilitatorOnly, async (req, res) => {
    res.json({ children: await facilitatorChildren(req.user!.id) });
    return;
  });

  // GET /api/v1/facilitator/children/:childId/stories: that child's story history.
  router.get("/children/:childId/stories", facilitatorOnly, async (req, res) => {
    res.json({ stories: await facilitatorStoryHistory(req.user!.id, String(req.params.childId)) });
    return;
  });

  // GET /api/v1/facilitator/stories/:storyId: open one story (written to the audit log).
  router.get("/stories/:storyId", facilitatorOnly, async (req, res) => {
    res.json({ story: await facilitatorViewStory(req.user!.id, String(req.params.storyId), req.ip) });
    return;
  });

  return router;
}
