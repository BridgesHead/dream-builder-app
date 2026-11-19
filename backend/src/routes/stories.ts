import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import { createStoryRateLimits } from "../middleware/rateLimits.js";
import * as review from "../services/storyReview.js";
import * as stories from "../services/stories.js";
import { StoryPatchSchema } from "../types/story.js";

// Story drafts and the wizard API (guide BE-08). Mounted at /api/v1/stories.
//
//   the child (child session)    starts a draft, saves each step, asks to generate, reads
//   the parent (verified)        reads their children's stories
//   facilitator, admin           403 here: they use their own read-only routes (BE-05)
//
// Draft review (BE-12), while the story is in child_review (the child) or parent_review
// (the parent); anything else is 409 STORY_LOCKED:
//   PATCH /:id/panels/:number               the child   new words for one page
//   PATCH /:id/comic-cells/:page/:cell      the child   new caption / dialogue for one comic cell
//   POST  /:id/panels/:number/redraw        the child   a new picture (background job)
//   POST  /:id/panels/:number/rewrite       the child   one better sentence (Creator only)
//   POST  /:id/submit                       the child   "I'm done!" → parent_review
//   GET   /:id/comments                     both        the parent's notes
//   POST  /:id/comments                     the parent  notes; a change request → child_review
//   POST  /:id/approve                      the parent  → approved (locked)

const createSchema = z.object({ authorName: z.string().max(100).optional() }).strict();
const listQuery = z.object({ childId: z.string().max(100).optional() }).strict();

// BE-12 bodies. The text limits match the story model (panel text 4000, caption 1000, dialogue 500).
const panelEditSchema = z.object({ text: z.string().trim().min(1, "A page needs some words").max(4000) }).strict();
const cellEditSchema = z
  .object({ caption: z.string().trim().max(1000).optional(), dialogue: z.string().trim().max(500).nullable().optional() })
  .strict()
  .refine((b) => b.caption !== undefined || b.dialogue !== undefined, { message: "Send a caption or dialogue" });
const rewriteSchema = z.object({ sentence: z.string().trim().min(1).max(500) }).strict();
const commentsSchema = z
  .object({
    comments: z
      .array(
        z
          .object({
            // null = about the whole story
            panelNumber: z.number().int().min(1).max(15).nullable().default(null),
            text: z.string().trim().min(1, "A note can't be empty").max(2000),
            type: z.enum(["comment", "change_request"]).default("comment"),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

// The child on this device, from the token (never the body).
const childCaller = (req: Request): review.ChildCaller => ({
  childId: req.childSession!.childId,
  parentId: req.childSession!.parentId,
  ip: req.ip ?? null,
});
const parentCaller = (req: Request): review.ParentCaller => ({ parentId: req.user!.id, ip: req.ip ?? null });

// Who is asking, from the token: never from the request body.
function actorOf(req: Request): stories.StoryActor {
  if (req.childSession) return { kind: "child", childId: req.childSession.childId };
  return { kind: "parent", parentId: req.user!.id };
}

export function createStoriesRouter(): Router {
  const router = Router();
  const childOnly = allow("child_session");
  const childOrParent = allow("child_session", "verified_parent");
  const parentOnly = allow("verified_parent");
  const limits = createStoryRateLimits();

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

  // POST /api/v1/stories/:id/generate: refused with the missing steps if the draft isn't
  // complete; otherwise 202 and the story is made in the background (BE-07).
  router.post("/:id/generate", childOnly, async (req, res) => {
    await stories.startGeneration(childCaller(req), String(req.params.id));
    res.status(202).json({ status: await stories.getStatus(actorOf(req), String(req.params.id)) });
    return;
  });

  // POST /api/v1/stories/:id/generate/retry: put the jobs that failed every try back on the list.
  router.post("/:id/generate/retry", childOnly, async (req, res) => {
    await stories.retryGeneration(req.childSession!.childId, String(req.params.id));
    res.status(202).json({ status: await stories.getStatus(actorOf(req), String(req.params.id)) });
    return;
  });

  // GET /api/v1/stories/:id/status: progress for Final Climb (FE-06). Asked every 2 seconds.
  router.get("/:id/status", childOrParent, async (req, res) => {
    res.json({ status: await stories.getStatus(actorOf(req), String(req.params.id)) });
    return;
  });

  // GET /api/v1/stories/:id/panels/:number/image → { url, expiresAt }: a short-lived link to
  // that panel's picture in our storage (BE-10). 404 if the panel has no picture yet.
  router.get("/:id/panels/:number/image", childOrParent, async (req, res) => {
    res.json(await stories.panelImageLink(actorOf(req), String(req.params.id), String(req.params.number)));
    return;
  });

  // ---- Draft review (BE-12) ----

  router.patch("/:id/panels/:number", childOnly, validate(panelEditSchema), async (req, res) => {
    res.json({ panel: await review.editPanel(childCaller(req), String(req.params.id), String(req.params.number), req.body.text) });
    return;
  });

  router.patch("/:id/comic-cells/:page/:cell", childOnly, validate(cellEditSchema), async (req, res) => {
    const cell = await review.editComicCell(childCaller(req), String(req.params.id), String(req.params.page), String(req.params.cell), req.body);
    res.json({ cell });
    return;
  });

  // 202: the picture is drawn in the background; GET /status shows it under "redraws".
  router.post("/:id/panels/:number/redraw", childOnly, async (req, res) => {
    res.status(202).json({ redraw: await review.startRedraw(childCaller(req), String(req.params.id), String(req.params.number)) });
    return;
  });

  router.post("/:id/panels/:number/rewrite", childOnly, limits.rewrite, validate(rewriteSchema), async (req, res) => {
    res.json(await review.rewriteSentence(childCaller(req), String(req.params.id), String(req.params.number), req.body.sentence));
    return;
  });

  router.post("/:id/submit", childOnly, async (req, res) => {
    res.json(await review.submitForReview(childCaller(req), String(req.params.id)));
    return;
  });

  router.get("/:id/comments", childOrParent, async (req, res) => {
    res.json({ comments: await review.listComments(actorOf(req), String(req.params.id)) });
    return;
  });

  router.post("/:id/comments", parentOnly, validate(commentsSchema), async (req, res) => {
    res.status(201).json(await review.addComments(parentCaller(req), String(req.params.id), req.body.comments));
    return;
  });

  router.post("/:id/approve", parentOnly, async (req, res) => {
    res.json(await review.approveStory(parentCaller(req), String(req.params.id)));
    return;
  });

  return router;
}
