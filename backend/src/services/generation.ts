import { Job, Story } from "../db/models/index.js";
import type { JobType } from "../db/models/job.js";
import { enqueueJob } from "../jobs/queue.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { PANEL_COUNT, type StoryPath, type WorkStatus } from "../types/story.js";
import { canChangeStatus } from "./storyLifecycle.js";

// Story generation (guide BE-07): starting it, retrying failed jobs, noticing when it's
// finished, and the status that Final Climb and Book Progress Detail show.
//
//   POST /generate  → story draft → generating, jobs: story_text + title
//   story_text done → one panel_image job per panel
//   every job done  → story generating → child_review

const DONE: WorkStatus[] = ["success", "fallback"];

/**
 * Makes sure one job exists for this story / type / panel, and is on the list if it's waiting.
 * Safe to call twice (a retried story_text job does): it never makes a second job.
 */
export async function ensureJob(storyId: string, type: JobType, panelNumber: number | null = null): Promise<void> {
  const job = await Job.findOneAndUpdate(
    { storyId, type, panelNumber, cellNumber: null },
    { $setOnInsert: { status: "queued" } },
    { upsert: true, new: true },
  );
  if (job.status === "queued") await enqueueJob(String(job._id));
}

// Called after every finished job: if everything is done, the child can read the story.
export async function finishIfDone(storyId: string): Promise<void> {
  const story = await Story.findById(storyId, { status: 1, storyPath: 1, panels: 1 }).lean();
  if (!story || story.status !== "generating" || !story.storyPath) return;
  const expected = PANEL_COUNT[story.storyPath as StoryPath];
  const panelsDone =
    story.panels.length === expected && story.panels.every((p) => DONE.includes(p.textStatus) && DONE.includes(p.imageStatus));
  const jobs = await Job.find({ storyId }, { status: 1 }).lean();
  if (!panelsDone || jobs.some((j) => !DONE.includes(j.status))) return;
  if (!canChangeStatus("generating", "child_review")) return;
  // Only from "generating", so two jobs finishing together can't both do it.
  await Story.updateOne({ _id: storyId, status: "generating" }, { $set: { status: "child_review", storyGeneratedAt: new Date() } });
}

// Called by POST /stories/:id/generate once the draft passed its checks (stories.ts).
export async function beginGeneration(storyId: string): Promise<void> {
  // Only from "draft": two taps on the button can't start it twice.
  const moved = await Story.updateOne({ _id: storyId, status: "draft" }, { $set: { status: "generating" } });
  if (moved.modifiedCount === 0) throw new AppError(409, "INVALID_STATUS_CHANGE", "This story is already being made");
  try {
    await ensureJob(storyId, "story_text");
    await ensureJob(storyId, "title");
  } catch (err) {
    // The queue is down: put the story back so the child can try again.
    logger.error({ err, storyId }, "Could not queue story generation");
    await Job.deleteMany({ storyId, status: "queued" });
    await Story.updateOne({ _id: storyId, status: "generating" }, { $set: { status: "draft" } });
    throw new AppError(503, "GENERATION_NOT_READY", "We couldn't start making your story. Please try again.");
  }
}

// POST /stories/:id/generate/retry: only the jobs that failed every try go back on the list.
export async function retryFailed(storyId: string): Promise<number> {
  const failed = await Job.find({ storyId, status: "failed" }).lean();
  if (failed.length === 0) throw new AppError(409, "CONFLICT", "Nothing to try again");
  for (const job of failed) {
    const claimed = await Job.updateOne({ _id: job._id, status: "failed" }, { $set: { status: "queued", error: null } });
    if (claimed.modifiedCount === 0) continue;
    if (job.type === "panel_image") {
      await Story.updateOne({ _id: storyId, "panels.number": job.panelNumber }, { $set: { "panels.$.imageStatus": "queued" } });
    }
    // A new key, so the queue runs it again (the old key is already used up).
    await enqueueJob(String(job._id), `${String(job._id)}-retry-${job.attempts}`);
  }
  return failed.length;
}

// In-memory queue only (your PC): a restart forgets the list, so put unfinished jobs back.
export async function recoverJobs(): Promise<void> {
  const generating = await Story.find({ status: "generating" }, { _id: 1 }).lean();
  const jobs = await Job.find({ storyId: { $in: generating.map((s) => s._id) }, status: { $in: ["queued", "running"] } }).lean();
  for (const job of jobs) await enqueueJob(String(job._id));
  if (jobs.length > 0) logger.info({ count: jobs.length }, "Put unfinished jobs back on the list");
}

// ---- Status (Final Climb FE-06, Book Progress Detail FE-15) ---------------------------------

type StoryLike = { _id: unknown; status: string; storyPath?: string | null; panels: { number: number; textStatus: WorkStatus; imageStatus: WorkStatus }[] };

async function buildStatus(story: StoryLike) {
  const storyId = String(story._id);
  const jobs = await Job.find({ storyId }).sort({ createdAt: 1 }).lean();
  const expected = story.storyPath ? PANEL_COUNT[story.storyPath as StoryPath] : 0;
  const textJob = jobs.find((j) => j.type === "story_text");

  // Before the text exists there are no panels yet: show them waiting on the text job.
  const panels = Array.from({ length: expected }, (_, i) => {
    const saved = story.panels.find((p) => p.number === i + 1);
    return {
      number: i + 1,
      textStatus: saved?.textStatus ?? textJob?.status ?? "queued",
      imageStatus: saved?.imageStatus ?? (textJob?.status === "failed" ? "failed" : "queued"),
    };
  });

  // Progress: the text, the title and one unit per picture.
  const titleJob = jobs.find((j) => j.type === "title");
  const units = [textJob?.status, titleJob?.status, ...panels.map((p) => p.imageStatus)];
  const finished = story.status !== "draft" && story.status !== "generating";
  const done = units.filter((s) => s && DONE.includes(s)).length;
  const progress = finished ? 100 : units.length ? Math.floor((done / units.length) * 100) : 0;

  const failed = jobs
    .filter((j) => j.status === "failed")
    .map((j) => ({ type: j.type, panelNumber: j.panelNumber ?? null, error: j.error ?? null }));

  return { jobs, payload: { storyId, status: story.status, progress, panels, failed, canRetry: story.status === "generating" && failed.length > 0 } };
}

/** What the child and the parent see. */
export async function storyStatus(story: StoryLike) {
  return (await buildStatus(story)).payload;
}

/** Book Progress Detail (admin): the same, plus every job and the story-rule violations. */
export async function adminProgress(storyId: string) {
  const story = await Story.findById(storyId).lean();
  if (!story) throw new AppError(404, "NOT_FOUND", "Story not found");
  const { jobs, payload } = await buildStatus(story);
  return {
    ...payload,
    jobs: jobs.map((j) => ({
      id: String(j._id),
      type: j.type,
      status: j.status,
      panelNumber: j.panelNumber ?? null,
      provider: j.provider ?? null,
      aiModel: j.aiModel ?? null,
      durationMs: j.durationMs ?? null,
      attempts: j.attempts,
      error: j.error ?? null,
      violations: j.violations,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    })),
    violations: jobs.flatMap((j) => j.violations.map((v) => ({ ...v, jobType: j.type }))),
  };
}
