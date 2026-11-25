// BE-07: the job queue and generation status, against a real (test) MongoDB.
// On a PC without Redis this tests the in-memory queue; CI sets REDIS_URL, so there it tests
// BullMQ + Redis, including a worker that crashes mid-job.
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Job, Story } from "../../src/db/models/index.js";
import { stubControls } from "../../src/jobs/providers.js";
import { closeQueue, queueKind, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { runJob } from "../../src/jobs/runJob.js";
import { closeRedis } from "../../src/lib/redis.js";
import { ensureJob } from "../../src/services/generation.js";
import { bearer, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

const app = createApp();
let worker: RunningWorker | null = null;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(runJob);
});

afterEach(() => stubControls.reset());

afterAll(async () => {
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
});

// Asks `check` again and again until it's true (or gives up after `ms`).
async function waitFor(check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}

const statusOf = async (id: string) => (await Story.findById(id).lean())!.status;

const STEPS = [
  { authorName: "Alex", selectedFormat: "storybook", comicVibe: "soft-peaceful", heroType: "fox", charName: "Ember", heroPronoun: "she" },
  { charStrengths: ["kind-heart"], aspiration: "be a vet" },
  { obstacles: ["grumpy-giant"], heartColor: "jumpy", braveMove: "ask-for-help", heroWords: "I can start." },
  { safePlaceText: "the tree house" },
  { obstacles2: ["glass-wall"], heartColor2: "foggy", braveMove2: "lead-the-way", heroWords2: "I'll try another way." },
];
const ACT_3 = { obstacles3: ["roaring-fire"], heartColor3: "steady", braveMove3: "deep-breaths", heroWords3: "I keep going." };

// A family whose child has a complete draft (two or three acts).
async function completeDraft(threeActs = false) {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id);
  const child = await makeChildSession(parent.id, childId);
  const created = await request(app).post("/api/v1/stories").set(bearer(child)).send({});
  const id = created.body.story.id as string;
  for (const step of [...STEPS, { facesChallenge3: threeActs }, ...(threeActs ? [ACT_3] : [])]) {
    expect((await request(app).patch(`/api/v1/stories/${id}`).set(bearer(child)).send(step)).status).toBe(200);
  }
  return { parent, child, id };
}

const generate = (token: string, id: string) => request(app).post(`/api/v1/stories/${id}/generate`).set(bearer(token));
const status = (token: string, id: string) => request(app).get(`/api/v1/stories/${id}/status`).set(bearer(token));

describe(`generation (${queueKind()} queue)`, () => {
  it("a complete two-act draft becomes a story with 12 panels, each with text and a picture", async () => {
    const { child, id } = await completeDraft();
    const res = await generate(child, id);
    expect(res.status).toBe(202);
    expect(res.body.status.status).toBe("generating");

    await waitFor(async () => (await statusOf(id)) === "child_review");
    const story = (await Story.findById(id).lean())!;
    expect(story.panels).toHaveLength(12);
    for (const panel of story.panels) {
      expect(panel.text).not.toBe("");
      expect(panel.imageKey).toMatch(/^stories\/[0-9a-f]{24}\/panel-\d{2}\.png$/); // a key in our bucket, never a web link
      expect([panel.textStatus, panel.imageStatus]).toEqual(["success", "success"]);
    }
    expect(story.title).toBe("Ember and the be a vet");
    expect(story.storyGeneratedAt).not.toBeNull();

    // Final Climb's endpoint shows it finished.
    const done = await status(child, id);
    expect(done.body.status).toMatchObject({ status: "child_review", progress: 100, failed: [], canRetry: false });
    expect(done.body.status.panels).toHaveLength(12);
  });

  it("a three-act draft gets 15 panels, and every job records provider, model, duration and tries", async () => {
    const { child, id } = await completeDraft(true);
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    expect((await Story.findById(id).lean())!.panels).toHaveLength(15);

    const jobs = await Job.find({ storyId: id }).lean();
    // 1 text + 1 title + 15 pictures, each exactly once.
    expect(jobs).toHaveLength(17);
    expect(jobs.filter((j) => j.type === "panel_image").map((j) => j.panelNumber).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    for (const job of jobs) {
      expect(job).toMatchObject({ status: "success", provider: "stub", aiModel: "stub-v1", attempts: 1 });
      expect(job.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("a try that fails is retried, and the job records how many tries it took", async () => {
    stubControls.failTimes.set("panel_image:3", 2);
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const job = (await Job.findOne({ storyId: id, type: "panel_image", panelNumber: 3 }).lean())!;
    expect(job).toMatchObject({ status: "success", attempts: 3, error: null });
  });

  it("a job that fails every try is marked failed with its reason; Try again finishes the story", async () => {
    stubControls.failTimes.set("panel_image:5", config.queue.attempts);
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await Job.exists({ storyId: id, status: "failed" })) !== null);
    // Let the other jobs finish too.
    await waitFor(async () => (await Job.countDocuments({ storyId: id, status: { $in: ["queued", "running"] } })) === 0);

    const job = (await Job.findOne({ storyId: id, panelNumber: 5 }).lean())!;
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(config.queue.attempts);
    expect(job.error).toContain("failed on purpose");

    // The story waits in "generating", and Final Climb can show the retry state.
    expect(await statusOf(id)).toBe("generating");
    const shown = (await status(child, id)).body.status;
    expect(shown.canRetry).toBe(true);
    expect(shown.failed).toEqual([{ type: "panel_image", panelNumber: 5, pageNumber: null, cellNumber: null, error: job.error }]);
    expect(shown.panels[4].imageStatus).toBe("failed");
    expect(shown.progress).toBeLessThan(100);

    const retry = await request(app).post(`/api/v1/stories/${id}/generate/retry`).set(bearer(child));
    expect(retry.status).toBe(202);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    expect((await Story.findById(id).lean())!.panels[4].imageKey).toMatch(/^stories\/[0-9a-f]{24}\/panel-05\.png$/);
  });

  it("Try again with nothing failed is refused", async () => {
    const { child, id } = await completeDraft();
    await generate(child, id);
    const res = await request(app).post(`/api/v1/stories/${id}/generate/retry`).set(bearer(child));
    expect(res.status).toBe(409);
    await waitFor(async () => (await statusOf(id)) === "child_review");
  });

  it("tapping generate twice starts it only once", async () => {
    const { child, id } = await completeDraft();
    const [first, second] = await Promise.all([generate(child, id), generate(child, id)]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    expect(await Job.countDocuments({ storyId: id, type: "story_text" })).toBe(1);
  });

  it("asking for the same job twice (e.g. a retried text job) never makes a second job", async () => {
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    // What a retried story_text job does: queue the picture jobs again.
    await ensureJob(id, "panel_image", 1);
    await ensureJob(id, "panel_image", 1);
    expect(await Job.countDocuments({ storyId: id, type: "panel_image", panelNumber: 1 })).toBe(1);
    expect(await Job.countDocuments({ storyId: id, type: "panel_image" })).toBe(12);
  });

  it("the parent can follow the status; another family can't", async () => {
    const { parent, child, id } = await completeDraft();
    await generate(child, id);
    expect((await status(parent.token, id)).status).toBe(200);
    const stranger = await makeUser("parent");
    expect((await status(stranger.token, id)).status).toBe(404);
    await waitFor(async () => (await statusOf(id)) === "child_review");
  });

  it("Book Progress Detail (admin) shows every job and per-panel status for any story", async () => {
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const admin = await makeUser("admin");
    const res = await request(app).get(`/api/v1/admin/stories/${id}/progress`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.progress.panels).toHaveLength(12);
    expect(res.body.progress.jobs).toHaveLength(14);
    expect(res.body.progress.jobs[0]).toMatchObject({ provider: "stub", aiModel: "stub-v1", attempts: 1 });
    // The stub leaves out the closing line on purpose; the engine repairs it and logs it (BE-09).
    expect(res.body.progress.violations).toEqual([
      expect.objectContaining({ rule: "R9 Practice Anchor closure", panelNumber: 12, fixedBy: "repaired", jobType: "story_text" }),
    ]);
    expect((await request(app).get(`/api/v1/admin/stories/665f1c2ab0d4e1a2b3c4d5e6/progress`).set(bearer(admin.token))).status).toBe(404);
  });
});

describe("the story engine inside generation (BE-09)", () => {
  it("every saved story passes the engine: closing line, Brave-Step phrase, the child's words", async () => {
    const { child, id } = await completeDraft(true);
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const panels = (await Story.findById(id).lean())!.panels;
    expect(panels[14].text.endsWith("One real step today.")).toBe(true);
    expect(panels[13].text).toContain("Ember took her next brave step toward becoming the vet");
    expect(panels[4].text).toContain('"I can start."');
    expect(panels[11].text).toMatch(/"I keep going\."$/);
  });

  it("a skipped panel is rewritten, and the job records it (defect 5)", async () => {
    stubControls.brokenPanel.set(6, 1); // the AI's first draft leaves out Panel 6
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    expect((await Story.findById(id).lean())!.panels[5].text).not.toBe("");
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job.attempts).toBe(1);
    expect(job.violations).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "Panel plan (D5)", panelNumber: 6, fixedBy: "rewritten" })]));
  });

  it("still broken after 2 rewrites: the try fails with the reason, and the next try starts fresh", async () => {
    stubControls.brokenPanel.set(6, 3); // the first draft and both rewrites leave Panel 6 out
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job.attempts).toBe(2);
  });

  it("broken on every try: the job fails with the reason and the violations, shown to the admin", async () => {
    stubControls.brokenPanel.set(6, 1000);
    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await Job.exists({ storyId: id, type: "story_text", status: "failed" })) !== null);
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job.error).toContain("Story rules still broken after 2 rewrites");
    expect(job.violations).toEqual(expect.arrayContaining([expect.objectContaining({ panelNumber: 6, fixedBy: "failed" })]));

    const admin = await makeUser("admin");
    const progress = (await request(app).get(`/api/v1/admin/stories/${id}/progress`).set(bearer(admin.token))).body.progress;
    expect(progress.violations).toEqual(expect.arrayContaining([expect.objectContaining({ panelNumber: 6, fixedBy: "failed" })]));
    expect(progress.canRetry).toBe(true);

    // Defect 3 fixed: the reason reaches the caller (Final Climb's status), not just the logs.
    const shown = (await status(child, id)).body.status;
    expect(shown.failed[0]).toMatchObject({ type: "story_text", error: expect.stringContaining("Panel 6") });
  });
});

// Needs real Redis: CI runs it; on a PC without Redis it's skipped.
describe.skipIf(queueKind() !== "bullmq")("a worker that crashes mid-job (BullMQ)", () => {
  it("the job is retried by another worker: no lost job, no duplicate panel", async () => {
    // Swap the normal worker for one that will "crash" while drawing panel 4.
    await worker?.close();
    const crashing = startWorker(runJob, { lockDurationMs: 1000, stalledIntervalMs: 300 });
    stubControls.hangOnce.add("panel_image:4");

    const { child, id } = await completeDraft();
    await generate(child, id);
    await waitFor(async () => (await Job.exists({ storyId: id, panelNumber: 4, status: "running" })) !== null);
    await crashing.close(true); // gone mid-job, like a crashed server

    worker = startWorker(runJob, { lockDurationMs: 1000, stalledIntervalMs: 300 });
    await waitFor(async () => (await statusOf(id)) === "child_review", 30_000);

    const story = (await Story.findById(id).lean())!;
    expect(story.panels).toHaveLength(12);
    expect(new Set(story.panels.map((p) => p.number)).size).toBe(12);
    expect(await Job.countDocuments({ storyId: id, type: "panel_image" })).toBe(12);
    expect((await Job.findOne({ storyId: id, panelNumber: 4 }).lean())!.status).toBe("success");
  }, 40_000);
});
