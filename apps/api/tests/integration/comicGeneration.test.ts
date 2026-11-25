// BE-11: comic generation, against a real (test) MongoDB with the stub AI. The whole pipeline
// runs for real: story text → one script job per comic page → one picture job per cell.
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Job, Story } from "../../src/db/models/index.js";
import { stubControls } from "../../src/jobs/providers.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { processJob } from "../../src/jobs/dispatch.js";
import { closeRedis } from "../../src/lib/redis.js";
import { bearer, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

const app = createApp();
let worker: RunningWorker | null = null;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(processJob);
});

afterEach(() => stubControls.reset());

afterAll(async () => {
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
});

async function waitFor(check: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}

const STEPS = [
  { authorName: "Alex", selectedFormat: "comic", comicVibe: "clear-bold", heroType: "fox", charName: "Ember", heroPronoun: "she" },
  { charStrengths: ["kind-heart"], aspiration: "be a vet" },
  { obstacles: ["grumpy-giant"], heartColor: "jumpy", braveMove: "ask-for-help", heroWords: "I can start." },
  { safePlaceText: "the tree house" },
  { obstacles2: ["glass-wall"], heartColor2: "foggy", braveMove2: "lead-the-way", heroWords2: "I'll try another way." },
];
const ACT_3 = { obstacles3: ["roaring-fire"], heartColor3: "steady", braveMove3: "deep-breaths", heroWords3: "I keep going." };

async function comicDraft(threeActs = false) {
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
const statusOf = async (id: string) => (await Story.findById(id).lean())!.status;
const MUSIC_ONLY = /^[♩-♯\u{1D100}-\u{1D1FF}| ]+$/u;

// 32–40 picture jobs per comic: more than the default 5 s per test.
describe("BE-11 comic generation", { timeout: 30_000 }, () => {
  it("a two-act comic: exactly 32 cells on 8 pages (no third-act cells), each with its own picture", async () => {
    const { child, id } = await comicDraft();
    expect((await generate(child, id)).status).toBe(202);
    await waitFor(async () => (await statusOf(id)) === "child_review");

    const story = (await Story.findById(id).lean())!;
    expect(story.panels).toHaveLength(12); // the checked story text stays underneath
    expect(story.comicCells).toHaveLength(32);
    expect(Math.max(...story.comicCells.map((c) => c.page))).toBe(8);
    // Every page tells its part of the story (a single panel may be picture-only, like a real comic).
    for (let p = 1; p <= 8; p += 1) expect(story.comicCells.filter((c) => c.page === p).some((c) => c.caption || c.dialogue)).toBe(true);
    for (const c of story.comicCells) {
      expect(c.layout).toMatch(/^(big_top|big_bottom|tall|grid)$/);
      expect(c.imageKey).toMatch(/^stories\/[0-9a-f]{24}\/cell-\d{2}\.png$/);
      expect(c.imageStatus).toBe("success");
      expect(c.scene).not.toContain("Ember"); // the picture prompt never carries a name
      if (c.tempo) expect(c.tempo).toMatch(MUSIC_ONLY);
      expect(c.bubbleType === "none").toBe(!c.dialogue);
    }
    // A comic draws cells, not panels.
    const jobs = await Job.find({ storyId: id }).lean();
    expect(jobs.filter((j) => j.type === "panel_image")).toHaveLength(0);
    expect(jobs.filter((j) => j.type === "comic_script")).toHaveLength(8);
    expect(jobs.filter((j) => j.type === "comic_cell_image")).toHaveLength(32);
    // The brave-move page speaks the hero's own words (page 3 = First Pivot).
    expect(story.comicCells.filter((c) => c.page === 3).map((c) => c.dialogue)).toContain("I can start.");
    // Tempo only on the calm pages (Rest = page 4, Practice Anchor = page 8), at most once each.
    const tempoPages = story.comicCells.filter((c) => c.tempo).map((c) => c.page);
    expect(tempoPages.every((p) => p === 4 || p === 8)).toBe(true);
    expect(new Set(tempoPages).size).toBe(tempoPages.length);

    // The status the Final Climb shows, and the cells with picture links.
    const status = await request(app).get(`/api/v1/stories/${id}/status`).set(bearer(child));
    expect(status.body.status.cells).toHaveLength(32);
    expect(status.body.status.progress).toBe(100);
    const full = await request(app).get(`/api/v1/stories/${id}`).set(bearer(child));
    expect(full.body.story.comicCells[0].imageUrl).toMatch(/\/api\/v1\/media\/stories\/.+\/cell-01\.png\?expires=/);
  });

  it("a three-act comic has exactly 40 cells on 10 pages", async () => {
    const { child, id } = await comicDraft(true);
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const story = (await Story.findById(id).lean())!;
    expect(story.comicCells).toHaveLength(40);
    expect(Math.max(...story.comicCells.map((c) => c.page))).toBe(10);
  });

  it("a cell picture that fails once is retried and the comic still finishes", async () => {
    stubControls.failTimes.set("comic_cell_image:5", 1);
    const { child, id } = await comicDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const job = (await Job.findOne({ storyId: id, type: "comic_cell_image", cellNumber: 5 }).lean())!;
    expect(job.attempts).toBe(2);
    expect(job.status).toBe("success");
  });

  it("a page the AI fails on every try uses the backup splitter (a complete, plain page)", async () => {
    stubControls.failTimes.set("comic_script:2", config.queue.attempts);
    const { child, id } = await comicDraft();
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const job = (await Job.findOne({ storyId: id, type: "comic_script", pageNumber: 2 }).lean())!;
    expect(job.status).toBe("fallback");
    expect(job.fallbackUsed).toBe("comic_splitter");
    const story = (await Story.findById(id).lean())!;
    expect(story.comicCells.filter((c) => c.page === 2)).toHaveLength(4);
  });

  it("a storybook still draws panels, not cells", async () => {
    const parent = await makeUser("parent");
    const childId = await makeChild(parent.id);
    const child = await makeChildSession(parent.id, childId);
    const id = (await request(app).post("/api/v1/stories").set(bearer(child)).send({})).body.story.id as string;
    for (const step of [{ ...STEPS[0], selectedFormat: "storybook" }, ...STEPS.slice(1), { facesChallenge3: false }]) {
      await request(app).patch(`/api/v1/stories/${id}`).set(bearer(child)).send(step);
    }
    await generate(child, id);
    await waitFor(async () => (await statusOf(id)) === "child_review");
    const story = (await Story.findById(id).lean())!;
    expect(story.comicCells).toHaveLength(0);
    expect(story.panels.every((p) => p.imageKey)).toBe(true);
  });
});
