// BE-10: real generation through the fal.ai provider, against a FAKE fal.ai server (no real
// AI calls, no cost), a real (test) MongoDB and the local picture folder.
import { existsSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { STAND_IN } from "../../src/ai/prompts.js";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Job, Story } from "../../src/db/models/index.js";
import type { DraftPanel, StoryAnswers } from "../../src/engine/index.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { runJob } from "../../src/jobs/runJob.js";
import { closeRedis } from "../../src/lib/redis.js";
import { beginGeneration } from "../../src/services/generation.js";
import { EMBER_ANSWERS, EMBER_THREE_ACT, EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT } from "../fixtures/engine/samples.js";
import { startFakeFal, type FakeFal } from "../helpers/fakeFal.js";
import { bearer, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

const app = createApp();
let worker: RunningWorker | null = null;
let fal: FakeFal;

// The child named the hero "Zara" (it could be their own name), so "Zara" must never reach fal.ai.
const HERO = "Zara";

/** What the fake AI writes: the good sample story, using the stand-in name like the real AI would. */
const aiStory = (draft: DraftPanel[]) =>
  "```json\n" + JSON.stringify({ panels: draft }).replaceAll("Ember", STAND_IN) + "\n```";

beforeAll(async () => {
  fal = await startFakeFal();
  // This test file uses the fal.ai provider, pointed at the fake server.
  config.aiProvider = "fal";
  config.fal.key = "test-fal-key-123";
  config.fal.baseUrl = fal.url;
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(runJob);
});

afterEach(() => fal.reset());

afterAll(async () => {
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
  await fal.close();
});

async function waitFor(check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}

const settled = (id: string) => async () => (await Job.countDocuments({ storyId: id, status: { $in: ["queued", "running"] } })) === 0;

/** A complete story for Zara, started straight away. */
async function startStory(answers: StoryAnswers = EMBER_ANSWERS, draft = EMBER_THREE_ACT) {
  fal.story = aiStory(draft);
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id);
  const story = await Story.create({ childId, ...answers, charName: HERO });
  const id = String(story._id);
  await beginGeneration(id, { role: "child_session", parentId: parent.id });
  return { id, parent, childId };
}

const allSent = () => JSON.stringify(fal.requests);
const fluxCalls = () => fal.requests.filter((r) => r.path === "/fal-ai/flux/dev");

describe("BE-10 generation through fal.ai (fake server)", () => {
  it("a complete three-act draft is saved with 15 panels, each with text and a picture in OUR storage", async () => {
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const story = (await Story.findById(id).lean())!;

    expect(story.panels.map((p) => p.number)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const p of story.panels) {
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.text).not.toContain(STAND_IN); // the real name is back in
      expect(p.imageKey).toBe(`stories/${id}/panel-${String(p.number).padStart(2, "0")}.png`);
      expect(existsSync(path.join(config.storage.dir, p.imageKey!))).toBe(true);
    }
    expect(story.panels[0].text).toContain(HERO);
    // Never a fal.ai link anywhere in the story.
    expect(JSON.stringify(story)).not.toMatch(/https?:\/\/|\/files\//);
    expect(story.title).toBe("Zara and the Whispering Clinic");
  });

  it("records model, prompt version, fallback, duration and tries for every job", async () => {
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const jobs = await Job.find({ storyId: id }).lean();
    expect(jobs).toHaveLength(17);
    for (const job of jobs) {
      expect(job).toMatchObject({ status: "success", provider: "fal", promptVersion: "v1", fallbackUsed: null, attempts: 1 });
      expect(job.aiModel).toBe(job.type === "panel_image" ? config.fal.imageModel : config.fal.textModel);
      expect(job.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("the hero's name never reaches fal.ai (decision 6A)", async () => {
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    expect(fal.requests.length).toBeGreaterThan(17);
    expect(allSent()).not.toContain(HERO);
    expect(allSent()).toContain(STAND_IN);
  });

  it("every panel uses the same seed, the Character Blueprint, the dream costume and the Explorer style", async () => {
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const calls = fluxCalls();
    expect(calls).toHaveLength(15);
    expect(new Set(calls.map((c) => c.body.seed)).size).toBe(1);
    for (const c of calls) {
      const prompt = String(c.body.prompt);
      expect(prompt).toContain("watercolour");
      expect(prompt).toContain("golden-tipped tail"); // the fox blueprint
      expect(prompt).toContain("stethoscope"); // the vet costume
      expect(prompt).toContain("glasses"); // the child's tool
      expect(prompt).toContain("No text");
    }
  });

  it("a Creator story gets the concept-art style", async () => {
    const { id } = await startStory({ ...EMBER_ANSWERS, mode: "senior" });
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    expect(String(fluxCalls()[0].body.prompt)).toContain("concept art");
  });

  it("a two-act story makes exactly 12 panels: no text or picture for panels 13–15", async () => {
    const { id } = await startStory(EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT);
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const story = (await Story.findById(id).lean())!;
    expect(story.panels.map((p) => p.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await Job.countDocuments({ storyId: id, panelNumber: { $gt: 12 } })).toBe(0);
    expect(fluxCalls()).toHaveLength(12);
  });

  it("invalid JSON is retried, and the next try's story is saved", async () => {
    fal.storyReplies = ["Sorry, here is your story: once upon a time…"];
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job).toMatchObject({ status: "success", attempts: 2, error: null });
  });

  it("a wrong panel count on every try fails the story text and saves nothing half-built", async () => {
    const { id } = await startStory(EMBER_ANSWERS, EMBER_THREE_ACT.slice(0, 14));
    await waitFor(settled(id));
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(config.queue.attempts);
    expect(job.error).toContain("Expected 15 panels");
    const story = (await Story.findById(id).lean())!;
    expect(story.panels).toEqual([]);
    expect(story.status).toBe("generating"); // waiting for Try again, never "child_review"
    expect(await Job.countDocuments({ storyId: id, type: "panel_image" })).toBe(0);
  });

  it("when the Scene Director fails, the Visual Brief table is used and recorded as a fallback", async () => {
    fal.sceneFails = true;
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const story = (await Story.findById(id).lean())!;
    expect(story.panels.every((p) => p.imageStatus === "fallback")).toBe(true);
    const jobs = await Job.find({ storyId: id, type: "panel_image" }).lean();
    expect(jobs.every((j) => j.status === "fallback" && j.fallbackUsed === "visual_brief")).toBe(true);
    expect(String(fluxCalls()[0].body.prompt)).toContain("the clinic");
  });

  it("a title in the wrong shape falls back to the formula, recorded as a fallback", async () => {
    fal.title = "A Story About Being Brave";
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    expect((await Story.findById(id).lean())!.title).toBe("Zara and the Healing Meadow");
    expect(await Job.findOne({ storyId: id, type: "title" }).lean()).toMatchObject({ status: "fallback", fallbackUsed: "title_formula" });
  });

  it("a FLUX failure is retried; the picture is still saved", async () => {
    fal.fluxFailures = 1;
    const { id } = await startStory();
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const tries = (await Job.find({ storyId: id, type: "panel_image" }).lean()).map((j) => j.attempts);
    expect(tries.reduce((a, b) => a + b, 0)).toBe(16);
  });

  it("a download that isn't a picture fails the try (never saved)", async () => {
    fal.pictureType = "text/html";
    const { id } = await startStory(EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT);
    await waitFor(settled(id));
    const job = (await Job.findOne({ storyId: id, type: "panel_image", panelNumber: 1 }).lean())!;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("not a picture");
    expect((await Story.findById(id).lean())!.panels[0].imageKey).toBeNull();
  });
});

describe("BE-10 picture links", () => {
  it("the app gets a short-lived signed link; the link serves the picture; a changed link doesn't", async () => {
    const { id, parent, childId } = await startStory(EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT);
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const child = await makeChildSession(parent.id, childId);

    const res = await request(app).get(`/api/v1/stories/${id}/panels/3/image`).set(bearer(child));
    expect(res.status).toBe(200);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const link = new URL(res.body.url);
    expect(link.pathname).toBe(`/api/v1/media/stories/${id}/panel-03.png`);

    const picture = await request(app).get(link.pathname + link.search);
    expect(picture.status).toBe(200);
    expect(picture.headers["content-type"]).toBe("image/png");

    const tampered = link.search.replace(/sig=./, "sig=x");
    expect((await request(app).get(link.pathname + tampered)).status).toBe(404);
    const otherPanel = link.pathname.replace("panel-03", "panel-04") + link.search;
    expect((await request(app).get(otherPanel)).status).toBe(404);
    expect((await request(app).get(link.pathname)).status).toBe(404);

    // The parent can read it too; the story view carries a link per panel.
    const view = await request(app).get(`/api/v1/stories/${id}`).set(bearer(parent.token));
    expect(view.body.story.panels[0].imageUrl).toContain(`/api/v1/media/stories/${id}/panel-01.png?expires=`);
  });

  it("a panel with no picture, a wrong number, or someone else's story is 404", async () => {
    const { id } = await startStory(EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT);
    await waitFor(async () => (await Story.findById(id).lean())!.status === "child_review");
    const stranger = await makeUser("parent");
    expect((await request(app).get(`/api/v1/stories/${id}/panels/3/image`).set(bearer(stranger.token))).status).toBe(404);

    const parent = await makeUser("parent");
    const childId = await makeChild(parent.id);
    const child = await makeChildSession(parent.id, childId);
    const own = String((await Story.create({ childId, ...EMBER_TWO_ACT, charName: HERO }))._id);
    for (const n of ["3", "13", "abc"]) {
      expect((await request(app).get(`/api/v1/stories/${own}/panels/${n}/image`).set(bearer(child))).status).toBe(404);
    }
  });
});
