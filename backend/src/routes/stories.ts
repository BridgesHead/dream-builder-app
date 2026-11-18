import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import * as stories from "../services/stories.js";
import { StoryPatchSchema } from "../types/story.js";

// Story drafts and the wizard API (guide BE-08). Mounted at /api/v1/stories.
//
//   the child (child session)    starts a draft, saves each step, asks to generate, reads
//   the parent (verified)        reads their children's stories
//   facilitator, admin           403 here: they use their own read-only routes (BE-05)

const createSchema = z.object({ authorName: z.string().max(100).optional() }).strict();
const listQuery = z.object({ childId: z.string().max(100).optional() }).strict();

// Who is asking, from the token: never from the request body.
function actorOf(req: Request): stories.StoryActor {
  if (req.childSession) return { kind: "child", childId: req.childSession.childId };
  return { kind: "parent", parentId: req.user!.id };
}

export function createStoriesRouter(): Router {
  const router = Router();
  const childOnly = allow("child_session");
  const childOrParent = allow("child_session", "verified_parent");

  // POST /api/v1/stories  { authorName? } → a new draft for the child in this session.
  router.post("/", childOnly, validate(createSchema), async (req, res) => {
    const story = await stories.createDraft(req.childSession!.childId, req.body);
    res.status(201).json({ story });
    return;
  });

  // GET /api/v1/stories (?childId=... for a parent): summaries, newest first.
  router.get("/", childOrParent, async (req, res) => {
    // Query strings are checked here (the validate middleware checks bodies).
    const query = listQuery.safeParse(req.query);
    if (!query.success) {
      throw new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", z.flattenError(query.error).fieldErrors);
    }
    res.json({ stories: await stories.listStories(actorOf(req), query.data.childId) });
    return;
  });

  // GET /api/v1/stories/:id: every field of one story.
  router.get("/:id", childOrParent, async (req, res) => {
    res.json({ story: await stories.getStory(actorOf(req), String(req.params.id)) });
    return;
  });

  // PATCH /api/v1/stories/:id  { ...only the fields that changed } → save one wizard step.
  router.patch("/:id", childOnly, validate(StoryPatchSchema), async (req, res) => {
    const story = await stories.saveStep(req.childSession!.childId, String(req.params.id), req.body);
    res.json({ story });
    return;
  });

  // POST /api/v1/stories/:id/generate: refused with the missing steps if the draft isn't complete.
  router.post("/:id/generate", childOnly, async (req, res) => {
    await stories.startGeneration(req.childSession!.childId, String(req.params.id));
    res.status(202).end();
    return;
  });

  return router;
}
