// BE-18: the book PDF after payment, against a real (test) MongoDB, the local storage folder
// and the fake Stripe. The webhook is signed like Stripe signs it, so the real path runs:
// paid → the PDF job on the queue → files in storage → the download link.
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Stripe from "stripe";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Order, Story } from "../../src/db/models/index.js";
import { bookContentOf, recoverBookPdfs } from "../../src/jobs/bookPdf.js";
import { processJob } from "../../src/jobs/dispatch.js";
import { closeQueue, startWorker, type RunningWorker } from "../../src/jobs/queue.js";
import { closeRedis } from "../../src/lib/redis.js";
import { getStorage, panelImageKey } from "../../src/lib/storage.js";
import { fakeStripe } from "../../src/payments/provider.js";
import { bearer, makeChild, makeUser, TEST_PASSWORD } from "../helpers/actors.js";
import { FAKE_PNG } from "../helpers/fakeFal.js";

const app = createApp();
let worker: RunningWorker | null = null;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  worker = startWorker(processJob);
});

afterEach(() => fakeStripe.reset());

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

const ADDRESS = { fullName: "Sara Ali", phone: "+971 50 123 4567", line1: "Villa 12, Street 4", city: "Dubai", emirate: "Dubai" };
const WRITTEN = new Date("2026-03-14T08:00:00Z");

/** A parent with an approved story, its panels and pictures saved in storage. */
async function family(path: "two_act" | "three_act" = "two_act") {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id);
  const story = await Story.create({
    childId,
    mode: "junior",
    status: "approved",
    storyPath: path,
    title: "Ember and the Healing Paws",
    authorName: "Alex",
    charName: "ember",
    heroType: "fox",
    aspiration: "to be a vet",
    storyGeneratedAt: WRITTEN,
    approvedAt: new Date("2026-03-15T08:00:00Z"),
  });
  const storyId = String(story._id);
  // Panels 1–15 saved even for two_act: the book must still take only 1–12.
  const panels = [];
  for (let n = 1; n <= 15; n += 1) {
    const key = panelImageKey(storyId, n, "png");
    await getStorage().save(key, FAKE_PNG, "image/png");
    panels.push({ number: n, text: `Page ${n}.`, imageKey: key, textStatus: "success", imageStatus: "success" });
  }
  await Story.updateOne({ _id: story._id }, { $set: { panels } });
  return { parent, childId, storyId };
}

/** Checkout, then Stripe's signed "paid" webhook. Returns the order id. */
async function buy(token: string, storyId: string, tier: "digital" | "hardback") {
  const res = await request(app)
    .post("/api/v1/orders")
    .set(bearer(token))
    .send({ storyId, tier, ...(tier === "hardback" && { deliveryAddress: ADDRESS }) });
  expect(res.status).toBe(201);
  const orderId: string = res.body.order.id;
  await pay(orderId);
  return orderId;
}

async function pay(orderId: string) {
  const order = (await Order.findById(orderId).lean())!;
  const session = {
    object: "checkout.session",
    id: order.stripeSessionId,
    payment_status: "paid",
    amount_total: order.amountFils,
    currency: "aed",
    client_reference_id: orderId,
    metadata: { orderId },
    payment_intent: "pi_test_123",
  };
  const payload = JSON.stringify({ id: `evt_test_${randomUUID().replaceAll("-", "")}`, object: "event", type: "checkout.session.completed", data: { object: session } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: config.payments.stripeWebhookSecret! });
  const res = await request(app).post("/api/v1/payments/stripe/webhook").set("Content-Type", "application/json").set("Stripe-Signature", signature).send(payload);
  expect(res.status).toBe(200);
}

const orderOf = async (id: string) => (await Order.findById(id).lean())!;
const ready = (id: string) => async () => (await orderOf(id)).pdfStatus === "ready";
const download = (token: string, id: string) => request(app).get(`/api/v1/orders/${id}/download`).set(bearer(token));

describe("BE-18 the book PDF after payment", () => {
  it("a paid digital order gets its PDF; the paying parent can download it", async () => {
    const { parent, storyId } = await family();
    const orderId = await buy(parent.token, storyId, "digital");
    await waitFor(ready(orderId));

    const order = await orderOf(orderId);
    expect(order.pdfKey).toBe(`stories/${storyId}/print/${orderId}-download.pdf`);
    expect(order.printFileKey).toBeNull(); // no printer's file for a digital book
    expect(order.printStatus).toBe("not_needed");
    expect(order.pageCount).toBe(18); // cover, inside cover, title, mission, 12 panels, The End, back cover
    expect(order.printProfile).toBe("digital");
    expect(await AuditLog.countDocuments({ action: "order.pdf_ready", targetId: orderId })).toBe(1);

    // The order page sees it.
    const seen = await request(app).get(`/api/v1/orders/${orderId}`).set(bearer(parent.token));
    expect(seen.body.order.pdfStatus).toBe("ready");
    expect(JSON.stringify(seen.body)).not.toContain(".pdf"); // storage keys never reach the browser

    // The link, then the file itself through it.
    const res = await download(parent.token, orderId);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\/api\/v1\/media\/stories\/.+-download\.pdf\?expires=\d+&sig=.+&download=Ember-and-the-Healing-Paws$/);
    const file = await request(app).get(new URL(res.body.url).pathname + new URL(res.body.url).search);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toBe('attachment; filename="Ember-and-the-Healing-Paws.pdf"');
    expect(Buffer.from(file.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await AuditLog.countDocuments({ action: "order.download", targetId: orderId, actorId: parent.id })).toBe(1);
  });

  it("a paid hardback also gets the printer's file, and its print status moves to file_ready", async () => {
    const { parent, storyId } = await family("three_act");
    const orderId = await buy(parent.token, storyId, "hardback");
    await waitFor(ready(orderId));
    const order = await orderOf(orderId);
    expect(order.printFileKey).toBe(`stories/${storyId}/print/${orderId}-print.pdf`);
    expect(order.printStatus).toBe("file_ready");
    expect(order.printProfile).toBe("generic");
    expect(order.pageCount).toBe(21); // all 15 panels
    // The made-up pictures are the stub AI's 1×1 placeholders, so admin sees warnings.
    expect(order.pdfWarnings.some((w) => w.includes("only a placeholder picture"))).toBe(true);
    expect((await getStorage().read(order.printFileKey!)).length).toBeGreaterThan(1000);
    expect((await download(parent.token, orderId)).status).toBe(200);
  });

  it("downloads only for the paying parent: another parent gets 404, before payment 409", async () => {
    const { parent, storyId } = await family();
    const stranger = await makeUser("parent");
    const started = await request(app).post("/api/v1/orders").set(bearer(parent.token)).send({ storyId, tier: "digital" });
    const orderId: string = started.body.order.id;

    const unpaid = await download(parent.token, orderId);
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.code).toBe("NOT_PAID");

    await pay(orderId);
    await waitFor(ready(orderId));
    expect((await download(stranger.token, orderId)).status).toBe(404);
    expect((await download(parent.token, "not-an-id")).status).toBe(404);
    expect((await download(parent.token, new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });

  it("while the PDF is still being made: 409 PDF_NOT_READY", async () => {
    const { parent, storyId } = await family();
    const orderId = await buy(parent.token, storyId, "digital");
    await waitFor(ready(orderId));
    await Order.updateOne({ _id: orderId }, { $set: { pdfStatus: "making" } });
    const res = await download(parent.token, orderId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PDF_NOT_READY");
  });

  it("a story missing panels fails clearly (no half book) after the retries", async () => {
    const { parent, storyId } = await family();
    await Story.updateOne({ _id: storyId }, { $pull: { panels: { number: 5 } } });
    const orderId = await buy(parent.token, storyId, "digital");
    await waitFor(async () => (await orderOf(orderId)).pdfStatus === "failed");
    const order = await orderOf(orderId);
    expect(order.pdfError).toBe("The story has 11 of its 12 panels");
    expect(order.pdfAttempts).toBe(config.queue.attempts);
    expect(order.pdfKey).toBeNull();
  });

  it("the order shows its own story's title, so screens never mix two stories", async () => {
    const { parent, storyId } = await family();
    const orderId = await buy(parent.token, storyId, "digital");
    const one = await request(app).get(`/api/v1/orders/${orderId}`).set(bearer(parent.token));
    expect(one.body.order.storyTitle).toBe("Ember and the Healing Paws");
    const all = await request(app).get("/api/v1/orders").set(bearer(parent.token));
    expect(all.body.orders[0]).toMatchObject({ id: orderId, storyTitle: "Ember and the Healing Paws" });
  });

  it("at startup, a paid order that never got a PDF (paid before BE-18) gets one", async () => {
    const { parent, storyId } = await family();
    const orderId = await buy(parent.token, storyId, "digital");
    await waitFor(ready(orderId));
    // As an order paid before BE-18 existed looks: no PDF fields at all.
    await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(orderId) }, { $unset: { pdfStatus: "", pdfKey: "" } });
    await recoverBookPdfs();
    await waitFor(ready(orderId));
    expect((await download(parent.token, orderId)).status).toBe(200);
    // Two whole books are drawn here: a few seconds, more on a busy PC.
  }, 20_000);

  it("the cover uses the date the story was written, not the day the PDF is made", async () => {
    const { storyId } = await family();
    const content = await bookContentOf((await Story.findById(storyId).lean())!);
    expect(content.writtenOn.toISOString()).toBe(WRITTEN.toISOString());
    expect(content.heroName).toBe("Ember");
    expect(content.panels.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("deleting the child's data (BE-16) removes the PDFs; the order record stays", async () => {
    const { parent, childId, storyId } = await family();
    const orderId = await buy(parent.token, storyId, "digital");
    await waitFor(ready(orderId));
    const res = await request(app)
      .post(`/api/v1/children/${childId}/deletion`)
      .set(bearer(parent.token))
      .send({ password: TEST_PASSWORD });
    expect(res.status).toBe(202);
    await waitFor(async () => (await orderOf(orderId)).pdfStatus === "deleted");
    expect((await orderOf(orderId)).pdfKey).toBeNull();
    expect(await getStorage().countFolder(`stories/${storyId}/`)).toBe(0);
    expect((await download(parent.token, orderId)).status).toBe(409);
  });
});
