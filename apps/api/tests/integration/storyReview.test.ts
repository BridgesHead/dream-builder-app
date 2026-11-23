// BE-12: draft review, edits and approval, against a real (test) MongoDB and the stub AI.
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Comment, Job, Story } from "../../src/db/models/index.js";
import { stubControls } from "../../src/jobs/providers.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { runJob } from "../../src/jobs/runJob.js";
import { closeRedis } from "../../src/lib/redis.js";
import { getStorage } from "../../src/lib/storage.js";
import { bearer, linkToChild, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

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

async function waitFor(check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64"));

/**
 * A family with a story that's already made and waiting for the child's review: 12 panels,
 * each with text and a picture. Explorer (age 9) or Creator (age 13).
 */
async function storyInReview(mode: "junior" | "senior" = "junior") {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id, "Alex", mode === "senior" ? 13 : 9);
  const child = await makeChildSession(parent.id, childId);
  const story = await Story.create({
    childId,
    mode,
    status: "child_review",
    storyPath: "two_act",
    selectedFormat: "storybook",
    heroType: "fox",
    charName: "Ember",
    heroPronoun: "she",
    aspiration: "be a vet",
    storyGeneratedAt: new Date(),
    panels: Array.from({ length: 12 }, (_, i) => ({
      number: i + 1,
      text: `Page ${i + 1}. Ember walked on through the meadow.`,
      imageKey: `stories/seed/panel-${String(i + 1).padStart(2, "0")}.png`,
      textStatus: "success",
      imageStatus: "success",
    })),
  });
  const id = String(story._id);
  for (const p of story.panels) await getStorage().save(p.imageKey!, PNG, "image/png");
  return { parent, childId, child, id };
}

const api = (token: string) => ({
  edit: (id: string, n: number | string, text: string) => request(app).patch(`/api/v1/stories/${id}/panels/${n}`).set(bearer(token)).send({ text }),
  redraw: (id: string, n: number | string) => request(app).post(`/api/v1/stories/${id}/panels/${n}/redraw`).set(bearer(token)),
  rewrite: (id: string, n: number | string, sentence: string) =>
    request(app).post(`/api/v1/stories/${id}/panels/${n}/rewrite`).set(bearer(token)).send({ sentence }),
  submit: (id: string) => request(app).post(`/api/v1/stories/${id}/submit`).set(bearer(token)),
  comments: (id: string) => request(app).get(`/api/v1/stories/${id}/comments`).set(bearer(token)),
  comment: (id: string, comments: unknown[]) => request(app).post(`/api/v1/stories/${id}/comments`).set(bearer(token)).send({ comments }),
  approve: (id: string) => request(app).post(`/api/v1/stories/${id}/approve`).set(bearer(token)),
  status: (id: string) => request(app).get(`/api/v1/stories/${id}/status`).set(bearer(token)),
});

const storyOf = async (id: string) => (await Story.findById(id).lean())!;
const panelOf = async (id: string, n: number) => (await storyOf(id)).panels.find((p) => p.number === n)!;

describe("BE-12 the whole review, from a fresh story to approved", () => {
  it("every status change writes an audit entry, from generate to approve", async () => {
    // A real story: the wizard, then generation by the stub AI.
    const parent = await makeUser("parent");
    const childId = await makeChild(parent.id);
    const child = await makeChildSession(parent.id, childId);
    const id = (await request(app).post("/api/v1/stories").set(bearer(child)).send({})).body.story.id as string;
    const steps = [
      { authorName: "Alex", selectedFormat: "storybook", comicVibe: "soft-peaceful", heroType: "fox", charName: "Ember", heroPronoun: "she" },
      { charStrengths: ["kind-heart"], aspiration: "be a vet" },
      { obstacles: ["grumpy-giant"], heartColor: "jumpy", braveMove: "ask-for-help", heroWords: "I can start." },
      { safePlaceText: "the tree house" },
      { obstacles2: ["glass-wall"], heartColor2: "foggy", braveMove2: "lead-the-way", heroWords2: "I'll try another way." },
      { facesChallenge3: false },
    ];
    for (const step of steps) expect((await request(app).patch(`/api/v1/stories/${id}`).set(bearer(child)).send(step)).status).toBe(200);
    expect((await request(app).post(`/api/v1/stories/${id}/generate`).set(bearer(child))).status).toBe(202);
    await waitFor(async () => (await storyOf(id)).status === "child_review");

    const kid = api(child);
    const mum = api(parent.token);
    expect((await kid.edit(id, 2, "Ember had the kindest heart in the meadow.")).status).toBe(200);
    expect((await kid.submit(id)).body).toEqual({ status: "parent_review" });
    expect((await storyOf(id)).confirmedByChild).toBe(true);

    const sentBack = await mum.comment(id, [{ panelNumber: 2, text: "Could Ember say thank you here?", type: "change_request" }]);
    expect(sentBack.status).toBe(201);
    expect(sentBack.body.status).toBe("child_review");
    expect((await storyOf(id)).confirmedByChild).toBe(false);

    expect((await kid.submit(id)).status).toBe(200);
    const approved = await mum.approve(id);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    const final = await storyOf(id);
    expect(final.status).toBe("approved");
    expect(final.approvedAt).not.toBeNull();

    const audit = await AuditLog.find({ targetType: "story", targetId: id }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(audit.map((a) => a.action)).toEqual([
      "story.generate",
      "story.ready",
      "story.submit",
      "story.request_changes",
      "story.submit",
      "story.approve",
    ]);
    // Who did it: the child's session (on the parent's account), the worker, then the parent.
    expect(audit.map((a) => a.actorRole)).toEqual(["child_session", "system", "child_session", "parent", "child_session", "parent"]);
    expect(String(audit[5].actorId)).toBe(parent.id);
  });
});

describe("BE-12 inline edits", () => {
  it("a page edit keeps the previous text", async () => {
    const { child, id } = await storyInReview();
    const first = await api(child).edit(id, 3, "Ember dreamed of helping every animal.");
    expect(first.status).toBe(200);
    await api(child).edit(id, 3, "Ember dreamed of helping every animal she met.");
    const panel = await panelOf(id, 3);
    expect(panel.text).toBe("Ember dreamed of helping every animal she met.");
    expect(panel.previousTexts).toEqual(["Page 3. Ember walked on through the meadow.", "Ember dreamed of helping every animal."]);
  });

  it("a comic cell edit keeps the previous caption and dialogue", async () => {
    const { child, id } = await storyInReview();
    await Story.updateOne({ _id: id }, { $set: { comicCells: [{ page: 1, cell: 2, caption: "Morning.", dialogue: "Hello!", bubbleType: "speech" }] } });
    const res = await request(app).patch(`/api/v1/stories/${id}/comic-cells/1/2`).set(bearer(child)).send({ dialogue: "Good morning!" });
    expect(res.status).toBe(200);
    expect(res.body.cell).toMatchObject({ page: 1, cell: 2, caption: "Morning.", dialogue: "Good morning!" });
    expect(res.body.cell.previousVersions).toEqual([{ caption: "Morning.", dialogue: "Hello!" }]);
    // A cell the story doesn't have: 404.
    expect((await request(app).patch(`/api/v1/stories/${id}/comic-cells/9/4`).set(bearer(child)).send({ caption: "x" })).status).toBe(404);
  });

  it("bad page numbers are 404, empty text is 400", async () => {
    const { child, id } = await storyInReview();
    expect((await api(child).edit(id, 13, "Too far.")).status).toBe(404); // a two-act story has 12 pages
    expect((await api(child).edit(id, "abc", "Hi.")).status).toBe(404);
    expect((await api(child).edit(id, 0, "Hi.")).status).toBe(404);
    expect((await api(child).edit(id, 1, "   ")).status).toBe(400);
  });

  it("another family's story is 404; a facilitator gets 403", async () => {
    const { childId, id } = await storyInReview();
    const other = await storyInReview();
    expect((await api(other.child).edit(id, 1, "Not mine.")).status).toBe(404);
    expect((await api(other.child).submit(id)).status).toBe(404);
    expect((await api(other.parent.token).approve(id)).status).toBe(404);
    expect((await api(other.parent.token).comments(id)).status).toBe(404);

    const facilitator = await makeUser("facilitator");
    await linkToChild(facilitator.id, childId);
    expect((await api(facilitator.token).comments(id)).status).toBe(403);
    expect((await api(facilitator.token).approve(id)).status).toBe(403);
  });
});

describe("BE-12 the lock", () => {
  it("edits, redraws and rewrites are refused in parent_review and approved", async () => {
    const { parent, child, id } = await storyInReview("senior");
    const kid = api(child);
    expect((await kid.submit(id)).status).toBe(200);

    for (const status of ["parent_review", "approved"] as const) {
      if (status === "approved") expect((await api(parent.token).approve(id)).status).toBe(200);
      const edit = await kid.edit(id, 1, "Sneaky change.");
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe("STORY_LOCKED");
      expect((await kid.redraw(id, 1)).body.error.code).toBe("STORY_LOCKED");
      expect((await kid.rewrite(id, 1, "Ember walked on.")).body.error.code).toBe("STORY_LOCKED");
      expect((await kid.submit(id)).status).toBe(409);
    }
    expect((await panelOf(id, 1)).text).toBe("Page 1. Ember walked on through the meadow.");
    // Approved is the end: no second approval, no change request.
    expect((await api(parent.token).approve(id)).status).toBe(409);
    expect((await api(parent.token).comment(id, [{ text: "Change it", type: "change_request" }])).status).toBe(409);
  });

  it("the parent can't comment or approve before the child taps “I'm done!”", async () => {
    const { parent, id } = await storyInReview();
    expect((await api(parent.token).approve(id)).body.error.code).toBe("STORY_LOCKED");
    expect((await api(parent.token).comment(id, [{ text: "Lovely" }])).status).toBe(409);
  });
});

describe("BE-12 redrawing one picture", () => {
  it("a redraw saves a NEW picture and keeps the old one's key", async () => {
    const { child, id } = await storyInReview();
    const before = await panelOf(id, 4);
    const res = await api(child).redraw(id, 4);
    expect(res.status).toBe(202);
    expect(res.body.redraw).toMatchObject({ panelNumber: 4, status: "queued", redrawsLeft: 4 });

    await waitFor(async () => (await panelOf(id, 4)).redrawStatus === "success");
    const after = await panelOf(id, 4);
    expect(after.imageKey).not.toBe(before.imageKey);
    expect(after.imageKey).toMatch(/^stories\/[0-9a-f]{24}\/panel-04-r[0-9a-f]{24}\.png$/);
    expect(after.previousImageKeys).toEqual([before.imageKey]);

    const status = await api(child).status(id);
    expect(status.body.status.redraws).toEqual([{ panelNumber: 4, status: "success", error: null, canRetry: false }]);
    // Redraws are not story-making failures, and don't change the story's status.
    expect(status.body.status).toMatchObject({ status: "child_review", failed: [], canRetry: false });
  });

  it("a failed redraw keeps the old picture and offers a retry", async () => {
    const { child, id } = await storyInReview();
    const before = await panelOf(id, 3);
    stubControls.failTimes.set("panel_redraw:3", config.queue.attempts); // every try fails
    expect((await api(child).redraw(id, 3)).status).toBe(202);
    await waitFor(async () => (await panelOf(id, 3)).redrawStatus === "failed");

    expect((await panelOf(id, 3)).imageKey).toBe(before.imageKey);
    const status = await api(child).status(id);
    expect(status.body.status.redraws).toEqual([
      { panelNumber: 3, status: "failed", error: expect.stringContaining("failed on purpose"), canRetry: true },
    ]);

    // The retry: ask again. Failed redraws don't use up the allowance.
    const again = await api(child).redraw(id, 3);
    expect(again.status).toBe(202);
    expect(again.body.redraw.redrawsLeft).toBe(4);
    await waitFor(async () => (await panelOf(id, 3)).redrawStatus === "success");
    expect((await panelOf(id, 3)).imageKey).not.toBe(before.imageKey);
  });

  it("one redraw per page at a time, and “I'm done!” waits for it", async () => {
    const { child, id } = await storyInReview();
    await Story.updateOne({ _id: id, "panels.number": 5 }, { $set: { "panels.$.redrawStatus": "running" } });
    expect((await api(child).redraw(id, 5)).body.error.code).toBe("REDRAW_IN_PROGRESS");
    expect((await api(child).submit(id)).body.error.code).toBe("REDRAW_IN_PROGRESS");
    expect((await storyOf(id)).status).toBe("child_review");
  });

  it("a story can ask for REDRAWS_PER_STORY new pictures, then 409", async () => {
    const { child, id } = await storyInReview();
    await Job.insertMany(Array.from({ length: config.review.redrawsPerStory }, () => ({ storyId: id, type: "panel_redraw", panelNumber: 1, status: "success" })));
    const res = await api(child).redraw(id, 2);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REDRAW_LIMIT");
  });

  it("a redraw whose story moved on stops and keeps the old picture", async () => {
    const { child, id } = await storyInReview();
    const before = await panelOf(id, 6);
    stubControls.hangOnce.add("panel_redraw:6"); // the first try never finishes…
    await api(child).redraw(id, 6);
    await waitFor(async () => (await panelOf(id, 6)).redrawStatus === "running");
    // …and meanwhile the story leaves the child (forced here; "I'm done!" itself waits).
    await Story.updateOne({ _id: id }, { $set: { status: "parent_review" } });
    await waitFor(async () => (await panelOf(id, 6)).redrawStatus === "failed");
    expect((await panelOf(id, 6)).imageKey).toBe(before.imageKey);
  });
});

describe("BE-12 the Creator-mode sentence rewriter", () => {
  it("returns one sentence within the word limit, and changes nothing by itself", async () => {
    const { child, id } = await storyInReview("senior");
    const res = await api(child).rewrite(id, 1, "Ember walked on through the meadow.");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ panelNumber: 1, original: "Ember walked on through the meadow.", maxWords: config.review.rewriteMaxWords });
    const suggestion = res.body.suggestion as string;
    expect(suggestion).toBe("Step by step, Ember walked on through the meadow.");
    expect(suggestion.split(/\s+/).length).toBeLessThanOrEqual(config.review.rewriteMaxWords);
    expect((await panelOf(id, 1)).text).toBe("Page 1. Ember walked on through the meadow.");
  });

  it("asks again when the AI's answer breaks the rules", async () => {
    const { child, id } = await storyInReview("senior");
    stubControls.badRewrites = config.review.rewriteAttempts - 1; // all but the last try are bad
    const res = await api(child).rewrite(id, 2, "The fox smiled.");
    expect(res.status).toBe(200);
    expect(res.body.suggestion).toBe("Step by step, the fox smiled.");
  });

  it("gives up with REWRITE_FAILED after REWRITE_ATTEMPTS bad answers", async () => {
    const { child, id } = await storyInReview("senior");
    stubControls.badRewrites = config.review.rewriteAttempts;
    const res = await api(child).rewrite(id, 2, "The fox smiled.");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("REWRITE_FAILED");
  });

  it("refuses Explorer stories with 403", async () => {
    const { child, id } = await storyInReview("junior");
    const res = await api(child).rewrite(id, 1, "Ember walked on.");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("BE-12 parent comments", () => {
  it("are stored apart from the child's text, with author and time, and never change panel text", async () => {
    const { parent, child, id } = await storyInReview();
    await api(child).submit(id);
    const res = await api(parent.token).comment(id, [
      { panelNumber: 2, text: "What a lovely page!" },
      { panelNumber: null, text: "Great story overall." },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("parent_review"); // plain comments don't send it back
    expect(res.body.comments).toHaveLength(2);
    expect(res.body.comments[0]).toMatchObject({ panelNumber: 2, type: "comment", text: "What a lovely page!", authorName: "Test parent" });

    const saved = await Comment.find({ storyId: id }).lean();
    expect(saved.map((c) => String(c.authorId))).toEqual([parent.id, parent.id]);
    for (const c of saved) expect(c.createdAt).toBeInstanceOf(Date);
    // The panels are exactly as the child left them.
    const story = await storyOf(id);
    expect(story.panels.map((p) => p.text)).toEqual(Array.from({ length: 12 }, (_, i) => `Page ${i + 1}. Ember walked on through the meadow.`));

    // The child can read them (to know what to change).
    const forChild = await api(child).comments(id);
    expect(forChild.status).toBe(200);
    expect(forChild.body.comments.map((c: { text: string }) => c.text)).toEqual(["What a lovely page!", "Great story overall."]);
  });

  it("a page the story doesn't have is 400; the author can't be set from the body", async () => {
    const { parent, child, id } = await storyInReview();
    await api(child).submit(id);
    expect((await api(parent.token).comment(id, [{ panelNumber: 13, text: "Too far" }])).status).toBe(400);
    expect((await api(parent.token).comment(id, [{ text: "Hi", authorId: "665f1c2ab0d4e1a2b3c4d5e6" }])).status).toBe(400);
    expect(await Comment.countDocuments({ storyId: id })).toBe(0);
  });
});
