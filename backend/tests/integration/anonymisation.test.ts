// BE-14: the anonymising gate, end to end. A child "Aisha Rahman" whose answers include her
// own name, her school and her mother's phone number makes a story through the fal.ai
// provider (pointed at the FAKE fal.ai server), and we check every byte that was sent.
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Job, Story, User } from "../../src/db/models/index.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { runJob } from "../../src/jobs/runJob.js";
import { closeRedis } from "../../src/lib/redis.js";
import { beginGeneration } from "../../src/services/generation.js";
import { EMBER_ANSWERS, EMBER_THREE_ACT } from "../fixtures/engine/samples.js";
import { startFakeFal, type FakeFal } from "../helpers/fakeFal.js";
import { makeChild, makeUser } from "../helpers/actors.js";

let worker: RunningWorker | null = null;
let fal: FakeFal;

beforeAll(async () => {
  fal = await startFakeFal();
  config.aiProvider = "fal";
  config.fal.key = "test-fal-key-123";
  config.fal.baseUrl = fal.url;
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(runJob);
});

afterAll(async () => {
  await worker?.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
  await fal.close();
});

async function waitFor(check: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}

// The hero has a made-up name, so it DOES reach the model (BE-14).
const HERO = "Sparkle";

// Everything that could identify Aisha's family. None of it may reach fal.ai.
const SECRETS = ["Aisha", "Rahman", "Mariam", "050 123 4567", "0501234567", "123 4567", "Al Noor", "aisha.r@gmail.com", "aisha-world", "Villa 12"];

describe("BE-14 a child's identifying details never reach fal.ai", () => {
  it("Aisha Rahman: her name, school and mother's phone are in none of the requests; the hero's name, pronoun and words are", async () => {
    // The fake AI answers with the sample story, about our hero.
    fal.story = "```json\n" + JSON.stringify({ panels: EMBER_THREE_ACT }).replaceAll("Ember", HERO) + "\n```";
    fal.title = `${HERO} and the Healing Paws`;

    const parent = await makeUser("parent");
    await User.updateOne({ _id: parent.id }, { $set: { name: "Mariam Rahman" } });
    const childId = await makeChild(parent.id, "Aisha Rahman", 9);
    const story = await Story.create({
      childId,
      ...EMBER_ANSWERS,
      charName: HERO,
      authorName: "Aisha Rahman",
      // Her own name, her school, her mother's name and phone, an email, a link and an address:
      oneMoreAmazingThing: "Aisha can whistle like a kettle, ask Mariam on 050 123 4567",
      safePlaceText: "Aisha's room at Villa 12, Al Wasl Road",
      thirdChallengeText: "my teacher at Al Noor Primary School (aisha.r@gmail.com, www.aisha-world.ae)",
    });
    const id = String(story._id);
    await beginGeneration(id, { role: "child_session", parentId: parent.id });
    await waitFor(async () => (await Job.countDocuments({ storyId: id, status: { $in: ["queued", "running"] } })) === 0 && (await Job.countDocuments({ storyId: id })) >= 2);

    const sent = JSON.stringify(fal.requests);
    expect(fal.requests.length).toBeGreaterThan(2);
    for (const secret of SECRETS) expect(sent).not.toContain(secret);
    expect(sent.toLowerCase()).not.toContain(parent.email.toLowerCase());

    // What the story still needs DOES reach the model: the hero's name, pronoun and chosen words.
    expect(sent).toContain(HERO);
    expect(sent).toMatch(/\bshe\b|\bher\b/);
    expect(sent).toContain(EMBER_ANSWERS.heroWords);
    expect(sent).toContain("whistle like a kettle");

    // Job records keep the anonymised requests only.
    const jobs = await Job.find({ storyId: id }).lean();
    const textJob = jobs.find((j) => j.type === "story_text")!;
    expect(textJob.aiRequests.length).toBeGreaterThan(0);
    expect(textJob.aiRequests[0].text).toContain(HERO);
    const recorded = JSON.stringify(jobs);
    for (const secret of SECRETS) expect(recorded).not.toContain(secret);
  });
});
