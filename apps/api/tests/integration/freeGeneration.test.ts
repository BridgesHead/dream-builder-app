// Free mode: generation through Gemini (text) and Cloudflare Workers AI (pictures), and the other
// mixes, against FAKE servers (no real AI calls, no cost), a real (test) MongoDB and the local
// picture folder. The story logic is the same as fal.ai's (tests/integration/falGeneration.test.ts);
// these tests check the new services are wired in, safe, and recorded correctly.
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PROMPT_VERSION, STAND_IN } from "../../src/ai/prompts.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Job, Story } from "../../src/db/models/index.js";
import type { DraftPanel } from "../../src/engine/index.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { runJob } from "../../src/jobs/runJob.js";
import { closeRedis } from "../../src/lib/redis.js";
import { beginGeneration } from "../../src/services/generation.js";
import { EMBER_ANSWERS, EMBER_THREE_ACT } from "../fixtures/engine/samples.js";
import { makeChild, makeUser } from "../helpers/actors.js";
import { CLOUDFLARE_TEST_ACCOUNT, CLOUDFLARE_TEST_TOKEN, GEMINI_TEST_KEY, startFakeFreeAi, type FakeFreeAi } from "../helpers/fakeFreeAi.js";

let worker: RunningWorker | null = null;
let ai: FakeFreeAi;

// The child named the hero after herself, so "Zara" must never reach any AI (BE-14).
const HERO = "Zara";

const aiStory = (draft: DraftPanel[]) => "```json\n" + JSON.stringify({ panels: draft }).replaceAll("Ember", STAND_IN) + "\n```";

function useProviders(text: typeof config.aiProvider, image: typeof config.aiProvider) {
  config.aiTextProvider = text;
  config.aiImageProvider = image;
}

beforeAll(async () => {
  ai = await startFakeFreeAi();
  config.aiProvider = "stub";
  config.gemini.key = GEMINI_TEST_KEY;
  config.gemini.baseUrl = ai.url;
  config.cloudflare.accountId = CLOUDFLARE_TEST_ACCOUNT;
  config.cloudflare.token = CLOUDFLARE_TEST_TOKEN;
  config.cloudflare.baseUrl = ai.url;
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(runJob);
});

afterEach(() => {
  ai.reset();
  useProviders("gemini", "cloudflare");
});

afterAll(async () => {
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
  await ai.close();
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
const reviewReady = (id: string) => async () => (await Story.findById(id).lean())!.status === "child_review";

async function startStory() {
  ai.story = aiStory(EMBER_THREE_ACT);
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id, HERO);
  const story = await Story.create({ childId, ...EMBER_ANSWERS, charName: HERO });
  const id = String(story._id);
  await beginGeneration(id, { role: "child_session", parentId: parent.id });
  return id;
}

const pictureCalls = (service: "gemini" | "cloudflare") =>
  ai.requests.filter((r) => r.service === service && (service === "gemini" ? !!r.body.generationConfig : r.path.includes("flux")));

describe("free mode: Gemini writes, Cloudflare draws", () => {
  it("makes a complete 15-panel draft with JPEG pictures in OUR storage", async () => {
    useProviders("gemini", "cloudflare");
    const id = await startStory();
    await waitFor(reviewReady(id));
    const story = (await Story.findById(id).lean())!;
    expect(story.panels).toHaveLength(15);
    expect(story.panels[0].text).toContain(HERO);
    for (const p of story.panels) expect(p.imageKey).toBe(`stories/${id}/panel-${String(p.number).padStart(2, "0")}.jpg`);
    expect(story.title).toBe("Zara and the Whispering Clinic");
    expect(pictureCalls("cloudflare")).toHaveLength(15);
  });

  it("records which service and model made each part", async () => {
    useProviders("gemini", "cloudflare");
    const id = await startStory();
    await waitFor(reviewReady(id));
    for (const job of await Job.find({ storyId: id }).lean()) {
      const picture = job.type === "panel_image";
      expect(job).toMatchObject({
        status: "success",
        provider: picture ? "cloudflare" : "gemini",
        aiModel: picture ? config.cloudflare.imageModel : config.gemini.textModel,
        promptVersion: PROMPT_VERSION,
      });
    }
  });

  it("the child's name never reaches either service; picture prompts fit Cloudflare's limit", async () => {
    useProviders("gemini", "cloudflare");
    const id = await startStory();
    await waitFor(reviewReady(id));
    const sent = JSON.stringify(ai.requests);
    expect(sent).not.toContain(HERO);
    expect(sent).toContain(STAND_IN);
    for (const c of pictureCalls("cloudflare")) {
      expect(String(c.body.prompt).length).toBeLessThanOrEqual(2048);
      expect(c.body.steps).toBe(config.cloudflare.imageSteps);
    }
  });

  it("a used-up free allowance (429) is retried, and the picture is still saved", async () => {
    useProviders("gemini", "cloudflare");
    ai.pictureFailures = 1;
    const id = await startStory();
    await waitFor(reviewReady(id));
    const tries = (await Job.find({ storyId: id, type: "panel_image" }).lean()).map((j) => j.attempts);
    expect(tries.reduce((a, b) => a + b, 0)).toBe(16);
  });

  it("when it stays used up, the job fails with a clear reason", async () => {
    useProviders("gemini", "cloudflare");
    ai.pictureFailures = 1000;
    const id = await startStory();
    await waitFor(settled(id));
    const job = (await Job.findOne({ storyId: id, type: "panel_image", panelNumber: 1 }).lean())!;
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/Cloudflare .* answered 429 \(rate limit or free allowance used up/);
    // 12 pictures × every retry, at the test rate limit: a few seconds, more on a busy PC.
  }, 30_000);

  it("a story Gemini blocks fails the story text with the reason, and saves nothing", async () => {
    useProviders("gemini", "cloudflare");
    ai.geminiBlocks = true;
    const id = await startStory();
    await waitFor(settled(id));
    const job = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("gave no text (SAFETY)");
    expect((await Story.findById(id).lean())!.panels).toEqual([]);
  });
});

describe("a busy Gemini model", () => {
  it("when the main model says 'high demand', the backup model answers straight away", async () => {
    useProviders("gemini", "cloudflare");
    const before = { main: config.gemini.textModel, backups: config.gemini.textBackupModels };
    config.gemini.textModel = "main-model";
    config.gemini.textBackupModels = ["backup-model"];
    ai.busyModels.add("main-model");
    try {
      const id = await startStory();
      await waitFor(reviewReady(id));
      const text = (await Job.findOne({ storyId: id, type: "story_text" }).lean())!;
      expect(text.status).toBe("success");
      expect(text.attempts).toBe(1); // no wait for a retry
      const models = ai.requests.filter((r) => r.service === "gemini").map((r) => r.path.split("/").pop()!.split(":")[0]);
      expect(models).toContain("main-model");
      expect(models).toContain("backup-model");
    } finally {
      config.gemini.textModel = before.main;
      config.gemini.textBackupModels = before.backups;
    }
  });

  it("a problem that isn't 'busy' (e.g. a blocked story) doesn't try the backup", async () => {
    useProviders("gemini", "cloudflare");
    ai.geminiBlocks = true;
    const id = await startStory();
    await waitFor(settled(id));
    expect((await Job.findOne({ storyId: id, type: "story_text" }).lean())!.status).toBe("failed");
    const backup = config.gemini.textBackupModels[0];
    expect(ai.requests.some((r) => r.service === "gemini" && r.path.includes(`/${backup}:`))).toBe(false);
  });
});

describe("comics (BE-11) through the free services", () => {
  it("Gemini writes each comic page, Cloudflare draws each cell, and the hero's name never leaves", async () => {
    useProviders("gemini", "cloudflare");
    ai.story = aiStory(EMBER_THREE_ACT);
    const parent = await makeUser("parent");
    const childId = await makeChild(parent.id, HERO);
    const story = await Story.create({ childId, ...EMBER_ANSWERS, charName: HERO, selectedFormat: "comic", comicVibe: "clear-bold" });
    const id = String(story._id);
    await beginGeneration(id, { role: "child_session", parentId: parent.id });
    await waitFor(reviewReady(id), 40_000);

    const saved = (await Story.findById(id).lean())!;
    expect(saved.comicCells).toHaveLength(40);
    // The real name is back in the words the child reads, never in the picture prompts.
    expect(saved.comicCells[0].caption).toBe(`${HERO} takes step 1.`);
    expect(saved.comicCells[0].scene).toBe("the hero walks along a sunny path");
    // Tempo keeps only music.
    expect(saved.comicCells.filter((c) => c.tempo).every((c) => c.tempo === "♪ ♫")).toBe(true);

    const pages = ai.requests.filter((r) => r.service === "gemini" && JSON.stringify(r.body.systemInstruction ?? "").includes("You are the writer of a premium comic picture book"));
    expect(pages).toHaveLength(10);
    const cells = ai.requests.filter((r) => r.service === "cloudflare" && r.path.includes("flux"));
    expect(cells).toHaveLength(40);
    // Jobs run side by side, so the requests can arrive in any order.
    const prompts = cells.map((c) => String(c.body.prompt));
    expect(prompts.every((p) => p.includes("comic book") && p.includes("bright saturated colours"))).toBe(true); // the chosen look
    expect(prompts.some((p) => p.includes("wide establishing shot"))).toBe(true); // page 1 opens with a big, wide panel
    expect(JSON.stringify(ai.requests)).not.toContain(HERO);
  }, 60_000);
});

describe("the other mixes", () => {
  it("Cloudflare for both: Llama gets the story prompt as messages, with room for 15 panels", async () => {
    useProviders("cloudflare", "cloudflare");
    const id = await startStory();
    await waitFor(reviewReady(id));
    const text = ai.requests.filter((r) => r.service === "cloudflare" && !r.path.includes("flux"));
    expect(text.length).toBeGreaterThan(0);
    for (const r of text) {
      expect(r.body.max_tokens).toBe(4096);
      expect((r.body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
    }
    expect(ai.requests.some((r) => r.service === "gemini")).toBe(false);
  });

  it("Gemini for both: pictures ask for an image with the story's one seed", async () => {
    useProviders("gemini", "gemini");
    const id = await startStory();
    await waitFor(reviewReady(id));
    const calls = pictureCalls("gemini");
    expect(calls).toHaveLength(15);
    expect(new Set(calls.map((c) => (c.body.generationConfig as { seed: number }).seed)).size).toBe(1);
    expect((await Story.findById(id).lean())!.panels[0].imageKey).toMatch(/\.png$/);
    // The nearest shape Gemini offers to the book's 16:10; gemini-2.5 has one size, so no "2K".
    for (const c of calls) expect((c.body.generationConfig as { imageConfig: unknown }).imageConfig).toEqual({ aspectRatio: "3:2" });
  });

  it("a Gemini 3 image model is asked for 2K pictures", async () => {
    useProviders("gemini", "gemini");
    const before = config.gemini.imageModel;
    config.gemini.imageModel = "gemini-3-pro-image";
    try {
      const id = await startStory();
      await waitFor(reviewReady(id));
      for (const c of pictureCalls("gemini")) {
        expect((c.body.generationConfig as { imageConfig: unknown }).imageConfig).toEqual({ aspectRatio: "3:2", imageSize: "2K" });
      }
    } finally {
      config.gemini.imageModel = before;
    }
  });

  it("a Cloudflare FLUX.2 model gets each comic panel in its own shape, as form data, with the story's seed", async () => {
    useProviders("gemini", "cloudflare");
    const before = config.cloudflare.imageModel;
    config.cloudflare.imageModel = "@cf/black-forest-labs/flux-2-klein-4b";
    try {
      ai.story = aiStory(EMBER_THREE_ACT);
      const parent = await makeUser("parent");
      const childId = await makeChild(parent.id, HERO);
      const story = await Story.create({ childId, ...EMBER_ANSWERS, charName: HERO, selectedFormat: "comic", comicVibe: "clear-bold" });
      const id = String(story._id);
      await beginGeneration(id, { role: "child_session", parentId: parent.id });
      await waitFor(reviewReady(id), 40_000);

      const cells = ai.requests.filter((r) => r.service === "cloudflare" && r.path.includes("flux"));
      expect(cells).toHaveLength(40);
      for (const c of cells) {
        expect(c.body.__format).toBe("form");
        expect(c.body.steps).toBeUndefined(); // flux-1-schnell's setting only
        // At most 1920 a side (Cloudflare's FLUX.2 limit), in steps of 32.
        expect(Math.max(Number(c.body.width), Number(c.body.height))).toBeLessThanOrEqual(1920);
        expect(Number(c.body.width) % 32).toBe(0);
      }
      expect(new Set(cells.map((c) => c.body.seed)).size).toBe(1);
      // Page 1 is "big_top": a wide panel on top, then three tall ones.
      const shapes = cells.map((c) => Number(c.body.width) / Number(c.body.height));
      expect(shapes.some((r) => r > 1.3)).toBe(true); // a big, wide panel
      expect(shapes.some((r) => r < 0.7)).toBe(true); // a small, tall panel
      expect(JSON.stringify(ai.requests)).not.toContain(HERO);
    } finally {
      config.cloudflare.imageModel = before;
    }
  }, 60_000);

  it("stub text with real pictures: the scene comes from the fallback table", async () => {
    useProviders("stub", "cloudflare");
    const id = await startStory();
    await waitFor(reviewReady(id));
    const jobs = await Job.find({ storyId: id }).lean();
    expect(jobs.filter((j) => j.type === "story_text").every((j) => j.provider === "stub")).toBe(true);
    const pictures = jobs.filter((j) => j.type === "panel_image");
    expect(pictures.every((j) => j.provider === "cloudflare" && j.fallbackUsed === "visual_brief")).toBe(true);
    expect(ai.requests.every((r) => r.path.includes("flux"))).toBe(true);
  });
});
