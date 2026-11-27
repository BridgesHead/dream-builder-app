import { config } from "../config.js";
import { Comment, Job, Story, User } from "../db/models/index.js";
import { cleanRewrite, rewriteProblems } from "../engine/index.js";
import { familyDetailsFor } from "../jobs/privacy.js";
import { getProvider, type StoryForAi } from "../jobs/providers.js";
import { enqueueJob } from "../jobs/queue.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { PANEL_COUNT, type StoryPath, type StoryStatus } from "../types/story.js";
import { findReachableStory, type StoryActor } from "./stories.js";
import { requireStatusChange, type StatusActor } from "./storyStatus.js";

// Draft review, edits and approval (guide BE-12).
//
//   child_review   the child:  edit a page's words or a comic cell, redraw a picture,
//                              ask for a better sentence (Creator only), "I'm done!"
//   parent_review  the parent: comments, change requests (→ back to child_review), approve
//   approved       locked: nothing changes any more
//
// Who may reach a story is decided by findReachableStory (404 for anyone else's story).

/** The child on the parent's device, as the routes know it from the token. */
export interface ChildCaller {
  childId: string;
  parentId: string;
  ip?: string | null;
}

/** A parent, as the routes know them from the token. */
export interface ParentCaller {
  parentId: string;
  ip?: string | null;
}

const childActor = (c: ChildCaller): StoryActor => ({ kind: "child", childId: c.childId });
const childStatusActor = (c: ChildCaller): StatusActor => ({ role: "child_session", parentId: c.parentId });

const KEEP_VERSIONS = 20; // older text versions kept per panel (so one page can't grow forever)

// ---- Small checks -------------------------------------------------------------------------

const LOCKED_MESSAGE: Partial<Record<StoryStatus, string>> = {
  draft: "This story hasn't been made yet",
  generating: "This story is still being made",
  child_review: "This story is back with the child for changes",
  parent_review: "This story is with a parent for review, so it can't be changed now",
  approved: "This story is approved and can't be changed any more",
};

function requireStatus(status: StoryStatus, wanted: StoryStatus): void {
  if (status !== wanted) throw new AppError(409, "STORY_LOCKED", LOCKED_MESSAGE[status] ?? "This story can't be changed now");
}

/** "3" → 3, if it's a panel number this story has; anything else is a 404. */
function panelNumberOf(story: { storyPath?: string | null }, raw: string): number {
  const max = story.storyPath ? PANEL_COUNT[story.storyPath as StoryPath] : 0;
  const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= max)) throw new AppError(404, "NOT_FOUND", "Page not found");
  return n;
}

/** The child's answers, as the AI provider needs them (the same shape the jobs use). */
async function forAi(story: Awaited<ReturnType<typeof findReachableStory>>): Promise<StoryForAi> {
  return {
    // For the anonymising gate (BE-14): what to keep out of the AI request.
    family: await familyDetailsFor(story),
    id: String(story._id),
    storyPath: story.storyPath as StoryPath,
    mode: story.mode,
    heroType: story.heroType ?? null,
    charName: story.charName,
    heroPronoun: story.heroPronoun ?? null,
    comicVibe: story.comicVibe ?? null,
    charTools: story.charTools,
    charStrengths: story.charStrengths,
    selfLove: story.selfLove,
    oneMoreAmazingThing: story.oneMoreAmazingThing,
    aspiration: story.aspiration,
    obstacles: story.obstacles,
    obstacles2: story.obstacles2,
    obstacles3: story.obstacles3,
    heartColor: story.heartColor,
    heartColor2: story.heartColor2,
    heartColor3: story.heartColor3,
    braveMove: story.braveMove,
    braveMove2: story.braveMove2,
    braveMove3: story.braveMove3,
    heroWords: story.heroWords,
    heroWords2: story.heroWords2,
    heroWords3: story.heroWords3,
    safePlaceText: story.safePlaceText,
    thirdChallengeText: story.thirdChallengeText,
  };
}

// ---- The child: edits -----------------------------------------------------------------------

/** PATCH /stories/:id/panels/:number { text }: new words for one page; the old ones are kept. */
export async function editPanel(caller: ChildCaller, storyId: string, rawNumber: string, text: string) {
  const story = await findReachableStory(childActor(caller), storyId);
  const n = panelNumberOf(story, rawNumber);
  requireStatus(story.status, "child_review");
  const panel = story.panels.find((p) => p.number === n);
  if (!panel) throw new AppError(404, "NOT_FOUND", "Page not found");

  if (panel.text !== text) {
    // Saved only if the story is STILL with the child: an "I'm done!" a moment earlier wins.
    const saved = await Story.updateOne(
      { _id: story._id, status: "child_review", "panels.number": n },
      {
        $set: { "panels.$.text": text },
        $push: { "panels.$.previousTexts": { $each: [panel.text], $slice: -KEEP_VERSIONS } },
      },
    );
    if (saved.modifiedCount === 0) throw new AppError(409, "STORY_LOCKED", LOCKED_MESSAGE.parent_review!);
  }
  const fresh = (await Story.findById(story._id, { panels: 1 }).lean())!;
  const p = fresh.panels.find((x) => x.number === n)!;
  return { number: p.number, text: p.text, previousTexts: p.previousTexts };
}

/** PATCH /stories/:id/comic-cells/:page/:cell { caption?, dialogue? }: the same for a comic cell. */
export async function editComicCell(
  caller: ChildCaller,
  storyId: string,
  rawPage: string,
  rawCell: string,
  change: { caption?: string; dialogue?: string | null },
) {
  const story = await findReachableStory(childActor(caller), storyId);
  const page = /^\d{1,2}$/.test(rawPage) ? Number(rawPage) : NaN;
  const cellNo = /^\d$/.test(rawCell) ? Number(rawCell) : NaN;
  const cell = story.comicCells.find((c) => c.page === page && c.cell === cellNo);
  if (!cell) throw new AppError(404, "NOT_FOUND", "Comic cell not found");
  requireStatus(story.status, "child_review");

  const next = { caption: change.caption ?? cell.caption, dialogue: change.dialogue !== undefined ? change.dialogue : (cell.dialogue ?? null) };
  if (next.caption !== cell.caption || next.dialogue !== (cell.dialogue ?? null)) {
    const saved = await Story.updateOne(
      { _id: story._id, status: "child_review" },
      {
        $set: { "comicCells.$[c].caption": next.caption, "comicCells.$[c].dialogue": next.dialogue },
        $push: { "comicCells.$[c].previousVersions": { $each: [{ caption: cell.caption, dialogue: cell.dialogue ?? null }], $slice: -KEEP_VERSIONS } },
      },
      { arrayFilters: [{ "c.page": page, "c.cell": cellNo }] },
    );
    if (saved.modifiedCount === 0) throw new AppError(409, "STORY_LOCKED", LOCKED_MESSAGE.parent_review!);
  }
  const fresh = (await Story.findById(story._id, { comicCells: 1 }).lean())!;
  const c = fresh.comicCells.find((x) => x.page === page && x.cell === cellNo)!;
  return { page: c.page, cell: c.cell, caption: c.caption, dialogue: c.dialogue ?? null, previousVersions: c.previousVersions };
}

// ---- The child: redraw one picture ----------------------------------------------------------

/**
 * POST /stories/:id/panels/:number/redraw: a new picture for one page, as a background job
 * (the same queue, retries and status as BE-07). The old picture stays until the new one
 * is ready. Asking again after a failed redraw is the retry.
 */
export async function startRedraw(caller: ChildCaller, storyId: string, rawNumber: string) {
  const story = await findReachableStory(childActor(caller), storyId);
  const n = panelNumberOf(story, rawNumber);
  requireStatus(story.status, "child_review");
  const panel = story.panels.find((p) => p.number === n);
  if (!panel?.imageKey) throw new AppError(404, "NOT_FOUND", "This page has no picture yet");

  // Failed redraws don't count: the child didn't get a picture from them.
  const used = await Job.countDocuments({ storyId: story._id, type: "panel_redraw", status: { $ne: "failed" } });
  if (used >= config.review.redrawsPerStory) {
    throw new AppError(409, "REDRAW_LIMIT", `This story has used all ${config.review.redrawsPerStory} new pictures`);
  }

  // Claim the panel: only one redraw per page at a time (two quick taps can't both start one).
  const claimed = await Story.updateOne(
    { _id: story._id, status: "child_review", panels: { $elemMatch: { number: n, redrawStatus: { $nin: ["queued", "running"] } } } },
    { $set: { "panels.$.redrawStatus": "queued" } },
  );
  if (claimed.modifiedCount === 0) {
    const now = await Story.findById(story._id, { status: 1 }).lean();
    if (now?.status !== "child_review") requireStatus(now!.status, "child_review");
    throw new AppError(409, "REDRAW_IN_PROGRESS", "A new picture for this page is already on its way");
  }

  const job = await Job.create({ storyId: story._id, type: "panel_redraw", panelNumber: n });
  try {
    await enqueueJob(String(job._id));
  } catch (err) {
    // The queue is down: undo, so the child can try again.
    logger.error({ err, storyId: String(story._id) }, "Could not queue a redraw");
    await Job.deleteOne({ _id: job._id });
    await Story.updateOne({ _id: story._id, "panels.number": n }, { $set: { "panels.$.redrawStatus": panel.redrawStatus ?? null } });
    throw new AppError(503, "GENERATION_NOT_READY", "We couldn't start drawing a new picture. Please try again.");
  }
  return { panelNumber: n, status: "queued" as const, redrawsLeft: config.review.redrawsPerStory - used - 1 };
}

// ---- The child: the Creator-mode sentence rewriter -------------------------------------------

/**
 * POST /stories/:id/panels/:number/rewrite { sentence }: ONE other way to say a sentence.
 * Creator mode only (Explorer: 403). The answer is checked (one sentence, the word limit, the
 * story's tone) and asked for again when it breaks a rule. It changes nothing by itself: the
 * child keeps it with an edit (PATCH /panels/:number).
 */
export async function rewriteSentence(caller: ChildCaller, storyId: string, rawNumber: string, sentence: string) {
  const story = await findReachableStory(childActor(caller), storyId);
  if (story.mode !== "senior") throw new AppError(403, "FORBIDDEN", "Sentence help is part of Creator mode");
  const n = panelNumberOf(story, rawNumber);
  requireStatus(story.status, "child_review");
  const panel = story.panels.find((p) => p.number === n);
  if (!panel) throw new AppError(404, "NOT_FOUND", "Page not found");

  const maxWords = config.review.rewriteMaxWords;
  const provider = getProvider();
  const aiStory = await forAi(story);
  let problems: string[] = [];
  for (let attempt = 0; attempt < config.review.rewriteAttempts; attempt += 1) {
    let answer: string;
    try {
      const result = await provider.rewriteSentence(aiStory, { sentence, panelText: panel.text, maxWords, attempt, problems });
      answer = cleanRewrite(result.value);
    } catch (err) {
      // The AI call itself failed: count it as a try and go again.
      logger.warn({ storyId, attempt, reason: err instanceof Error ? err.message : String(err) }, "Sentence rewrite call failed");
      problems = [];
      continue;
    }
    problems = rewriteProblems(answer, sentence, maxWords);
    if (problems.length === 0) return { panelNumber: n, original: sentence, suggestion: answer, maxWords };
    logger.info({ storyId, attempt, problems }, "Sentence rewrite refused; asking again");
  }
  throw new AppError(502, "REWRITE_FAILED", "We couldn't find a better sentence this time. Please try again.");
}

// ---- The child: "I'm done!" -----------------------------------------------------------------

/** POST /stories/:id/submit: child_review → parent_review. Waits until no picture is being redrawn. */
export async function submitForReview(caller: ChildCaller, storyId: string) {
  const story = await findReachableStory(childActor(caller), storyId);
  requireStatus(story.status, "child_review");
  if (story.panels.some((p) => p.redrawStatus === "queued" || p.redrawStatus === "running")) {
    throw new AppError(409, "REDRAW_IN_PROGRESS", "Wait for the new picture to finish, then tap “I'm done!” again");
  }
  await requireStatusChange(
    { storyId: String(story._id), from: "child_review", to: "parent_review", actor: childStatusActor(caller), ipAddress: caller.ip, alsoSet: { confirmedByChild: true } },
    "This story has already been sent to a parent",
  );
  return { status: "parent_review" as const };
}

// ---- Comments (the parent writes, both read) ------------------------------------------------

type CommentDoc = { _id: unknown; panelNumber?: number | null; type: string; text: string; authorId: unknown; createdAt: Date };

function commentView(c: CommentDoc, authorName: string | null) {
  return { id: String(c._id), panelNumber: c.panelNumber ?? null, type: c.type, text: c.text, authorName, createdAt: c.createdAt };
}

/** GET /stories/:id/comments: oldest first. The child reads them to know what to change. */
export async function listComments(actor: StoryActor, storyId: string) {
  const story = await findReachableStory(actor, storyId);
  const comments = await Comment.find({ storyId: story._id }).sort({ createdAt: 1, _id: 1 }).lean();
  const authors = await User.find({ _id: { $in: [...new Set(comments.map((c) => String(c.authorId)))] } }, { name: 1 }).lean();
  const nameOf = new Map(authors.map((a) => [String(a._id), a.name]));
  return comments.map((c) => commentView(c, nameOf.get(String(c.authorId)) ?? null));
}

export interface NewComment {
  panelNumber: number | null;
  text: string;
  type: "comment" | "change_request";
}

/**
 * POST /stories/:id/comments { comments: [...] }: the parent's notes, stored apart from the
 * child's words (they never change panel text). If any of them is a change request, the
 * story goes back to the child (parent_review → child_review).
 */
export async function addComments(caller: ParentCaller, storyId: string, comments: NewComment[]) {
  const story = await findReachableStory({ kind: "parent", parentId: caller.parentId }, storyId);
  requireStatus(story.status, "parent_review");
  const max = story.storyPath ? PANEL_COUNT[story.storyPath as StoryPath] : 0;
  const badPage = comments.find((c) => c.panelNumber !== null && c.panelNumber > max);
  if (badPage) {
    throw new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", { panelNumber: [`This story has ${max} pages`] });
  }

  const changes = comments.some((c) => c.type === "change_request");
  if (changes) {
    // Move first: if another tap already approved or sent it back, nothing is saved.
    await requireStatusChange(
      { storyId: String(story._id), from: "parent_review", to: "child_review", actor: { role: "parent", parentId: caller.parentId }, ipAddress: caller.ip, alsoSet: { confirmedByChild: false } },
      "This story was already approved or sent back",
    );
  }
  const saved = await Comment.insertMany(comments.map((c) => ({ ...c, storyId: story._id, authorId: caller.parentId })));
  const author = await User.findById(caller.parentId, { name: 1 }).lean();
  return {
    status: changes ? ("child_review" as const) : ("parent_review" as const),
    comments: saved.map((c) => commentView(c.toObject() as CommentDoc, author?.name ?? null)),
  };
}

// ---- The parent: approve ------------------------------------------------------------------------

/** POST /stories/:id/approve: parent_review → approved. The story is locked from now on. */
export async function approveStory(caller: ParentCaller, storyId: string) {
  const story = await findReachableStory({ kind: "parent", parentId: caller.parentId }, storyId);
  requireStatus(story.status, "parent_review");
  const approvedAt = new Date();
  await requireStatusChange(
    { storyId: String(story._id), from: "parent_review", to: "approved", actor: { role: "parent", parentId: caller.parentId }, ipAddress: caller.ip, alsoSet: { approvedAt } },
    "This story was already approved or sent back",
  );
  return { status: "approved" as const, approvedAt };
}
