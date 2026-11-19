// BE-16: deleting a child's data on request, against a real (test) MongoDB and the local
// storage folder. A child with a lot of data is counted before and after.
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Child, Comment, Consent, DeletionRequest, Job, Order, Story } from "../../src/db/models/index.js";
import { processJob } from "../../src/jobs/dispatch.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { closeRedis } from "../../src/lib/redis.js";
import { getStorage, storageFaults, storyFolder } from "../../src/lib/storage.js";
import { countChildData } from "../../src/services/deletion.js";
import { outbox } from "../../src/services/email.js";
import { bearer, linkToChild, makeChild, makeChildSession, makeUser, TEST_PASSWORD } from "../helpers/actors.js";

const app = createApp();
let worker: RunningWorker | null = null;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(processJob);
});

afterEach(() => {
  storageFaults.removeFailures = 0;
});

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
 * A family whose child has a lot of data: two stories (one with pictures, a redraw, comments
 * and AI job records), an open session, a facilitator link and a paid hardback that shipped.
 */
async function familyWithData(printStatus: "shipped" | "sent" = "shipped") {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id, "Alex", 9);
  const kid = await makeChildSession(parent.id, childId);
  const facilitator = await makeUser("facilitator");
  await linkToChild(facilitator.id, childId);

  const made = await Story.create({
    childId,
    mode: "junior",
    status: "approved",
    storyPath: "two_act",
    title: "Ember and the Healing Paws",
    charName: "Ember",
    panels: [1, 2, 3].map((n) => ({ number: n, text: `Page ${n}`, imageKey: `stories/x/panel-0${n}.png`, textStatus: "success", imageStatus: "success" })),
  });
  const draft = await Story.create({ childId, mode: "junior" });
  const storage = getStorage();
  for (const name of ["panel-01.png", "panel-02.png", "panel-03.png", "panel-02-rabc.png"]) {
    await storage.save(`${storyFolder(String(made._id))}${name}`, PNG, "image/png");
  }
  await Story.updateOne({ _id: made._id }, { $set: { "panels.0.imageKey": `${storyFolder(String(made._id))}panel-01.png` } });
  await Comment.create({ storyId: made._id, authorId: parent.id, text: "Lovely page!", panelNumber: 1 });
  await Job.create({ storyId: made._id, type: "story_text", status: "success", aiRequests: [{ endpoint: "fal-ai/any-llm", text: "Ember walked…" }] });
  await Job.create({ storyId: made._id, type: "panel_image", panelNumber: 1, status: "success" });
  const order = await Order.create({
    orderNumber: `DB-${Math.floor(Math.random() * 900000) + 100000}`,
    parentId: parent.id,
    storyId: made._id,
    tier: "hardback",
    amountFils: 14900,
    paymentStatus: "paid",
    printStatus,
    deliveryAddress: { fullName: "Sara Ali", phone: "+971501234567", line1: "Villa 12", city: "Dubai", emirate: "Dubai" },
    stripeSessionId: "cs_test_1",
    paidAt: new Date(),
  });
  return { parent, childId, kid, facilitator, storyId: String(made._id), draftId: String(draft._id), orderId: String(order._id) };
}

const deleteChild = (token: string, childId: string, password = TEST_PASSWORD) =>
  request(app).post(`/api/v1/children/${childId}/deletion`).set(bearer(token)).send({ password });

const doneOf = (id: string) => async () => (await DeletionRequest.findById(id).lean())?.status === "done";

describe("BE-16 the preview", () => {
  it("lists what will be deleted and what is kept", async () => {
    const { parent, childId } = await familyWithData();
    const res = await request(app).get(`/api/v1/children/${childId}/deletion-preview`).set(bearer(parent.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      child: { id: childId, name: "Alex" },
      willDelete: { stories: 2, comments: 1, files: 4, aiRecords: 2 },
      waitsForPrint: false,
    });
    expect(res.body.kept).toHaveLength(3);
  });
});

describe("BE-16 deleting", () => {
  it("needs the right password; a wrong one changes nothing", async () => {
    const { parent, childId } = await familyWithData();
    const res = await deleteChild(parent.token, childId, "wrong-password");
    expect(res.status).toBe(401);
    expect((await Child.findById(childId).lean())?.deletedAt).toBeNull();
    expect(await DeletionRequest.countDocuments({ childId })).toBe(0);
  });

  it("every record and file reaches zero, except the agreed kept ones", async () => {
    const { parent, childId, storyId, draftId, orderId } = await familyWithData();
    const other = await familyWithData(); // another family: must be untouched
    const storyIds = [storyId, draftId].map((id) => new mongoose.Types.ObjectId(id));
    const before = await countChildData(childId, storyIds);
    expect(before).toEqual({ stories: 2, comments: 1, jobs: 2, files: 4, sessions: 1, facilitatorLinks: 1, ordersKept: 1 });
    const consentsBefore = await Consent.countDocuments({ parentId: parent.id });

    const res = await deleteChild(parent.token, childId);
    expect(res.status).toBe(202);
    expect(res.body.request).toMatchObject({ childId, status: "queued" });
    await waitFor(doneOf(res.body.request.id));

    const after = await countChildData(childId, storyIds);
    expect(after).toEqual({ stories: 0, comments: 0, jobs: 0, files: 0, sessions: 0, facilitatorLinks: 0, ordersKept: 1 });
    expect(await Child.countDocuments({ _id: childId })).toBe(0);
    expect(await Story.countDocuments({ childId })).toBe(0);

    // Kept: the payment record (without the address), the consent, the audit entries.
    const order = (await Order.findById(orderId).lean())!;
    expect(order).toMatchObject({ paymentStatus: "paid", amountFils: 14900, deliveryAddress: null });
    expect(await Consent.countDocuments({ parentId: parent.id })).toBe(consentsBefore);

    // The request records what was deleted (counts only).
    const done = (await DeletionRequest.findById(res.body.request.id).lean())!;
    expect(done.counts).toMatchObject({ stories: 2, comments: 1, jobs: 2, files: 4, sessions: 1, facilitatorLinks: 1, ordersKept: 1 });
    expect(done.finishedAt).toBeInstanceOf(Date);

    // The other family still has everything.
    expect(await countChildData(other.childId, [other.storyId, other.draftId].map((id) => new mongoose.Types.ObjectId(id)))).toEqual(before);
  });

  it("the request and its completion each write an audit entry, with no story content", async () => {
    const { parent, childId } = await familyWithData();
    const res = await deleteChild(parent.token, childId);
    await waitFor(doneOf(res.body.request.id));
    const entries = await AuditLog.find({ targetType: "child", targetId: childId }).sort({ createdAt: 1 }).lean();
    expect(entries.map((e) => [e.action, e.actorRole])).toEqual([
      ["child.deletion_request", "parent"],
      ["child.deletion_complete", "system"],
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/Ember|Healing|Lovely|Alex|Page 1/);
  });

  it("a confirmation email says when backups age out", async () => {
    const { parent, childId } = await familyWithData();
    const res = await deleteChild(parent.token, childId);
    await waitFor(doneOf(res.body.request.id));
    const email = outbox.filter((e) => e.to === parent.email).at(-1)!;
    expect(email.subject).toMatch(/deleted/i);
    expect(email.text).toContain(`${config.deletion.backupRetentionDays} days`);
    expect(email.text).not.toMatch(/Alex|Ember/);
  });

  it("afterwards every API call and link for the child's content is 404, and the child's device is logged out", async () => {
    const { parent, childId, kid, facilitator, storyId } = await familyWithData();
    const story = await request(app).get(`/api/v1/stories/${storyId}`).set(bearer(parent.token));
    const pictureLink = new URL(story.body.story.panels[0].imageUrl);
    expect((await request(app).get(pictureLink.pathname + pictureLink.search)).status).toBe(200);

    const res = await deleteChild(parent.token, childId);
    await waitFor(doneOf(res.body.request.id));

    const as = bearer(parent.token);
    const calls = [
      request(app).get(`/api/v1/children/${childId}`).set(as),
      request(app).get(`/api/v1/children/${childId}/deletion-preview`).set(as),
      request(app).patch(`/api/v1/children/${childId}`).set(as).send({ name: "Back" }),
      request(app).get(`/api/v1/stories/${storyId}`).set(as),
      request(app).get(`/api/v1/stories/${storyId}/status`).set(as),
      request(app).get(`/api/v1/stories/${storyId}/comments`).set(as),
      request(app).get(`/api/v1/stories/${storyId}/panels/1/image`).set(as),
      request(app).get(`/api/v1/stories?childId=${childId}`).set(as),
      request(app).post(`/api/v1/auth/child-session`).set(as).send({ childId }),
      request(app).get(`/api/v1/facilitator/stories/${storyId}`).set(bearer(facilitator.token)),
      request(app).get(pictureLink.pathname + pictureLink.search),
    ];
    for (const r of await Promise.all(calls)) expect(r.status).toBe(404);
    // The child's wristband no longer works.
    expect((await request(app).get(`/api/v1/stories/${storyId}`).set(bearer(kid))).status).toBe(401);
    // And asking again finds nothing to delete.
    expect((await deleteChild(parent.token, childId)).status).toBe(404);
  });
});

describe("BE-16 safety", () => {
  it("while a hardback is printing, the deletion waits (the parent is told) and finishes once it ships", async () => {
    const saved = config.deletion.printCheckMs;
    config.deletion.printCheckMs = 50;
    try {
      const { parent, childId, orderId } = await familyWithData("sent");
      const res = await deleteChild(parent.token, childId);
      expect(res.status).toBe(202);
      expect(res.body.waitsForPrint).toBe(true);
      const id = res.body.request.id as string;
      await waitFor(async () => ((await DeletionRequest.findById(id).lean())?.printChecks ?? 0) >= 2);
      expect((await DeletionRequest.findById(id).lean())!.status).toBe("waiting_for_print");
      // Hidden already, but nothing deleted yet.
      expect((await Child.findById(childId).lean())?.deletedAt).toBeInstanceOf(Date);
      expect(await Story.countDocuments({ childId })).toBe(2);

      await Order.updateOne({ _id: orderId }, { $set: { printStatus: "shipped" } });
      await waitFor(doneOf(id));
      expect(await Story.countDocuments({ childId })).toBe(0);
    } finally {
      config.deletion.printCheckMs = saved;
    }
  });

  it("finishes even if a storage delete fails the first time (the job retries safely)", async () => {
    const { parent, childId, storyId } = await familyWithData();
    storageFaults.removeFailures = 1;
    const res = await deleteChild(parent.token, childId);
    await waitFor(doneOf(res.body.request.id));
    const done = (await DeletionRequest.findById(res.body.request.id).lean())!;
    expect(done.attempts).toBe(2);
    expect(done.counts.files).toBe(4); // counted once, not twice
    expect(await getStorage().countFolder(storyFolder(storyId))).toBe(0);
  });

  it("asking twice gives the same request; a request runs again safely", async () => {
    const { parent, childId } = await familyWithData("sent"); // waits, so the first is still open
    const first = await deleteChild(parent.token, childId);
    const second = await deleteChild(parent.token, childId);
    expect(second.status).toBe(202);
    expect(second.body.request.id).toBe(first.body.request.id);
    expect(await DeletionRequest.countDocuments({ childId })).toBe(1);

    // Running a finished request again does nothing.
    const { runDeletion } = await import("../../src/jobs/deletionJob.js");
    const { parent: p2, childId: c2 } = await familyWithData();
    const r2 = await deleteChild(p2.token, c2);
    await waitFor(doneOf(r2.body.request.id));
    await runDeletion(r2.body.request.id, { attempt: 1, isLastAttempt: true });
    expect((await DeletionRequest.findById(r2.body.request.id).lean())!.status).toBe("done");
  });

  it("someone else's request is 404; a child or facilitator can't delete (403)", async () => {
    const { parent, childId, kid, facilitator } = await familyWithData();
    expect((await deleteChild(kid, childId)).status).toBe(403);
    expect((await deleteChild(facilitator.token, childId)).status).toBe(403);
    const stranger = await makeUser("parent");
    expect((await deleteChild(stranger.token, childId)).status).toBe(404);

    const res = await deleteChild(parent.token, childId);
    expect((await request(app).get(`/api/v1/deletion-requests/${res.body.request.id}`).set(bearer(stranger.token))).status).toBe(404);
    const mine = await request(app).get(`/api/v1/deletion-requests/${res.body.request.id}`).set(bearer(parent.token));
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).not.toContain("Alex");
  });
});
