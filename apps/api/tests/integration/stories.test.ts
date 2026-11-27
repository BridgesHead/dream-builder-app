// BE-08: story drafts and the wizard API, against a real (test) MongoDB.
// One test per acceptance criterion, plus the ownership rules.
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { closeQueue } from "../../src/jobs/queue.js";
import { closeRedis } from "../../src/lib/redis.js";
import { ALL_MODELS, Child, Story } from "../../src/db/models/index.js";
import { bearer, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

const app = createApp();

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
});

// A parent with one child (age 8 = Explorer, 13 = Creator) and that child's session.
async function family(age = 8) {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id, "Alex", age);
  const child = await makeChildSession(parent.id, childId);
  return { parent, childId, child };
}

async function newDraft(token: string) {
  const res = await request(app).post("/api/v1/stories").set(bearer(token)).send({});
  expect(res.status).toBe(201);
  return res.body.story.id as string;
}

const save = (token: string, id: string, body: object) => request(app).patch(`/api/v1/stories/${id}`).set(bearer(token)).send(body);

// Every step of a two-act Explorer story, as the wizard would send it.
const EXPLORER_STEPS = [
  { authorName: "Alex" },
  { selectedFormat: "storybook" },
  { comicVibe: "soft-peaceful" },
  { heroType: "fox" },
  { charName: "Ember", heroPronoun: "she" },
  { charStrengths: ["kind-heart"], selfLove: "being kind" },
  { charTools: ["glasses"] },
  { aspiration: "be a vet" },
  { obstacles: ["grumpy-giant"] },
  { heartColor: "jumpy" },
  { braveMove: "ask-for-help", heroWords: "I can start with one small step." },
  { safePlaceText: "the tree house" },
  { obstacles2: ["glass-wall"], heartColor2: "foggy", braveMove2: "lead-the-way", heroWords2: "I'll try another way." },
];
const ACT_3 = { obstacles3: ["roaring-fire"], heartColor3: "steady", braveMove3: "deep-breaths", heroWords3: "I can keep going.", thirdChallengeText: "the last hill" };

describe("drafts", () => {
  it("a child starts a draft: it belongs to their child, in their child's mode", async () => {
    const { childId, child } = await family(13);
    const res = await request(app).post("/api/v1/stories").set(bearer(child)).send({ authorName: "Sam" });
    expect(res.status).toBe(201);
    expect(res.body.story).toMatchObject({ childId, mode: "senior", status: "draft", authorName: "Sam", storyPath: null });
  });

  it("can't choose the child or status in the body", async () => {
    const { child } = await family();
    const other = await family();
    const res = await request(app).post("/api/v1/stories").set(bearer(child)).send({ childId: other.childId, status: "approved" });
    expect(res.status).toBe(400);
  });

  it("reopening a saved draft restores every field, including Act 3 (defect 1)", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    for (const step of [...EXPLORER_STEPS, { facesChallenge3: true }, ACT_3, { oneMoreAmazingThing: "she can juggle" }]) {
      expect((await save(child, id, step)).status).toBe(200);
    }
    const res = await request(app).get(`/api/v1/stories/${id}`).set(bearer(child));
    expect(res.status).toBe(200);
    expect(res.body.story).toMatchObject({ ...Object.assign({}, ...EXPLORER_STEPS), facesChallenge3: true, storyPath: "three_act", ...ACT_3 });
  });

  it("switching from three acts to two clears obstacles3, braveMove3, heroWords3 and thirdChallengeText", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    await save(child, id, { facesChallenge3: true });
    await save(child, id, ACT_3);
    const res = await save(child, id, { facesChallenge3: false });
    expect(res.status).toBe(200);
    expect(res.body.story).toMatchObject({ storyPath: "two_act", obstacles3: [], heartColor3: "", braveMove3: "", heroWords3: "", thirdChallengeText: "" });
    // ...and Act 3 answers can't be added back while it has two acts.
    expect((await save(child, id, { obstacles3: ["roaring-fire"] })).status).toBe(400);
  });

  it("a 'they' pronoun is a validation error", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    const res = await save(child, id, { heroPronoun: "they" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fields.heroPronoun).toBeDefined();
  });

  it("Creator-only answers on an Explorer draft are a validation error", async () => {
    const { child } = await family(8);
    const id = await newDraft(child);
    const res = await save(child, id, { charStrengths: ["resilient"] });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.charStrengths).toBeDefined();
    // ...but fine on a Creator draft.
    const creator = await family(13);
    const creatorStory = await newDraft(creator.child);
    expect((await save(creator.child, creatorStory, { charStrengths: ["resilient"] })).status).toBe(200);
  });

  it("the story keeps its mode even if the parent changes the child's mode later", async () => {
    const { childId, child } = await family(8);
    const id = await newDraft(child);
    await Child.updateOne({ _id: childId }, { mode: "senior" });
    expect((await save(child, id, { charStrengths: ["resilient"] })).status).toBe(400);
  });

  it("a direct API caller gets the same normalised oneMoreAmazingThing (defect 8)", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    const res = await save(child, id, { oneMoreAmazingThing: "   she can    juggle.  " });
    expect(res.body.story.oneMoreAmazingThing).toBe("she can juggle");
  });

  it("a draft that has left 'draft' can't be changed here (409)", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    await Story.updateOne({ _id: id }, { status: "child_review" });
    const res = await save(child, id, { authorName: "Changed" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("STORY_NOT_DRAFT");
  });
});

describe("generation", () => {
  it("an incomplete draft is refused with the list of missing steps (defect 2)", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    await save(child, id, { authorName: "Alex", selectedFormat: "storybook" });
    const res = await request(app).post(`/api/v1/stories/${id}/generate`).set(bearer(child));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("STORY_INCOMPLETE");
    expect(res.body.error.fields.missingSteps[0]).toBe("style");
    expect(res.body.error.fields.missingSteps).toContain("gate");
  });

  it("three acts with no Act 3 answers is incomplete too", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    for (const step of [...EXPLORER_STEPS, { facesChallenge3: true }]) await save(child, id, step);
    const res = await request(app).post(`/api/v1/stories/${id}/generate`).set(bearer(child));
    expect(res.body.error.fields.missingSteps).toEqual(["act3.obstacle", "act3.feeling", "act3.move"]);
  });

  it("a complete draft starts generating (202); the job queue does the rest (BE-07)", async () => {
    const { child } = await family();
    const id = await newDraft(child);
    for (const step of [...EXPLORER_STEPS, { facesChallenge3: false }]) await save(child, id, step);
    const res = await request(app).post(`/api/v1/stories/${id}/generate`).set(bearer(child));
    expect(res.status).toBe(202);
    expect((await Story.findById(id).lean())!.status).toBe("generating");
    // ...and the wizard can't change it any more.
    expect((await save(child, id, { authorName: "Changed" })).status).toBe(409);
  });
});

describe("who can reach which story", () => {
  it("a child sees only their own stories; another child's story is 404", async () => {
    const a = await family();
    const b = await family();
    const aStory = await newDraft(a.child);
    await newDraft(b.child);

    const list = await request(app).get("/api/v1/stories").set(bearer(a.child));
    expect(list.body.stories.map((s: { id: string }) => s.id)).toEqual([aStory]);

    const bStory = await newDraft(b.child);
    expect((await request(app).get(`/api/v1/stories/${bStory}`).set(bearer(a.child))).status).toBe(404);
    expect((await save(a.child, bStory, { authorName: "Hacked" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/stories/${bStory}/generate`).set(bearer(a.child))).status).toBe(404);
  });

  it("brothers and sisters can't see each other's stories", async () => {
    const { parent, child } = await family();
    const siblingId = await makeChild(parent.id, "Sam", 10);
    const sibling = await makeChildSession(parent.id, siblingId);
    const siblingStory = await newDraft(sibling);
    expect((await request(app).get(`/api/v1/stories/${siblingStory}`).set(bearer(child))).status).toBe(404);
  });

  it("a parent reads their children's stories, and can filter to one child", async () => {
    const { parent, child, childId } = await family();
    const id = await newDraft(child);
    const all = await request(app).get("/api/v1/stories").set(bearer(parent.token));
    expect(all.body.stories.map((s: { id: string }) => s.id)).toEqual([id]);
    // The dashboard names an untitled draft after its hero: both are in the list.
    expect(all.body.stories[0]).toMatchObject({ heroType: null, charName: "" });
    const one = await request(app).get(`/api/v1/stories?childId=${childId}`).set(bearer(parent.token));
    expect(one.body.stories).toHaveLength(1);
    expect((await request(app).get(`/api/v1/stories/${id}`).set(bearer(parent.token))).status).toBe(200);
  });

  it("a parent can't reach another family's stories", async () => {
    const mine = await family();
    const theirs = await family();
    const theirStory = await newDraft(theirs.child);
    expect((await request(app).get(`/api/v1/stories/${theirStory}`).set(bearer(mine.parent.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/stories?childId=${theirs.childId}`).set(bearer(mine.parent.token))).status).toBe(404);
  });

  it("a removed child's stories are hidden from the parent", async () => {
    const { parent, child, childId } = await family();
    const id = await newDraft(child);
    await Child.updateOne({ _id: childId }, { deletedAt: new Date() });
    expect((await request(app).get(`/api/v1/stories/${id}`).set(bearer(parent.token))).status).toBe(404);
  });

  it("a nonsense id is 404, not 500", async () => {
    const { child } = await family();
    expect((await request(app).get("/api/v1/stories/not-an-id").set(bearer(child))).status).toBe(404);
  });

  it("a parent can't save wizard steps (403)", async () => {
    const { parent, child } = await family();
    const id = await newDraft(child);
    expect((await save(parent.token, id, { authorName: "Mum" })).status).toBe(403);
  });
});
