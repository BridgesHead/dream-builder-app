// BE-17: orders and Stripe Checkout, against a real (test) MongoDB and the fake Stripe.
// Webhooks are signed exactly like Stripe signs them (Stripe's own test helper), so the real
// signature check runs.
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import Stripe from "stripe";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Order, Story, StripeEvent } from "../../src/db/models/index.js";
import { closeQueue } from "../../src/jobs/queue.js";
import { closeRedis } from "../../src/lib/redis.js";
import { fakeStripe } from "../../src/payments/provider.js";
import { bearer, linkToChild, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

const app = createApp();

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterEach(() => fakeStripe.reset());

afterAll(async () => {
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
});

const ADDRESS = { fullName: "Sara Ali", phone: "+971 50 123 4567", line1: "Villa 12, Street 4", city: "Dubai", emirate: "Dubai" };

/** A parent with an approved story (or a story in another status). */
async function family(status: "approved" | "parent_review" = "approved") {
  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id);
  const story = await Story.create({ childId, mode: "junior", status, storyPath: "two_act", title: "Ember and the Healing Paws" });
  return { parent, childId, storyId: String(story._id) };
}

const checkout = (token: string, body: Record<string, unknown>) => request(app).post("/api/v1/orders").set(bearer(token)).send(body);

/** A webhook request, signed with the test webhook secret like Stripe would sign it. */
function webhook(type: string, session: Record<string, unknown>, eventId = `evt_test_${randomUUID().replaceAll("-", "")}`) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object: { object: "checkout.session", ...session } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: config.payments.stripeWebhookSecret! });
  return {
    eventId,
    send: () => request(app).post("/api/v1/payments/stripe/webhook").set("Content-Type", "application/json").set("Stripe-Signature", signature).send(payload),
  };
}

/** What Stripe sends when the parent paid on this order's page. */
async function paidSession(orderId: string, overrides: Record<string, unknown> = {}) {
  const order = (await Order.findById(orderId).lean())!;
  return {
    id: order.stripeSessionId,
    payment_status: "paid",
    amount_total: order.amountFils,
    currency: "aed",
    client_reference_id: orderId,
    metadata: { orderId },
    payment_intent: "pi_test_123",
    ...overrides,
  };
}

const orderOf = async (id: string) => (await Order.findById(id).lean())!;
const paidAudits = (id: string) => AuditLog.countDocuments({ action: "order.paid", targetType: "order", targetId: id });

describe("BE-17 prices", () => {
  it("come from server config, in AED", async () => {
    const { parent } = await family();
    const res = await request(app).get("/api/v1/orders/prices").set(bearer(parent.token));
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("AED");
    expect(res.body.tiers.map((t: { tier: string; total: number }) => [t.tier, t.total])).toEqual([
      ["digital", config.payments.prices.digital],
      ["hardback", config.payments.prices.hardback + config.payments.delivery.hardback],
    ]);
  });
});

describe("BE-17 starting checkout", () => {
  it("an approved story: an order (pending), a Stripe page in AED at the server's price, and an audit entry", async () => {
    const { parent, storyId } = await family();
    const res = await checkout(parent.token, { storyId, tier: "digital" });
    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/pay\/cs_test_fake_/);
    expect(res.body.order).toMatchObject({ storyId, tier: "digital", amount: config.payments.prices.digital, currency: "AED", paymentStatus: "pending", printStatus: "not_needed" });
    expect(res.body.order.orderNumber).toMatch(/^DB-\d{6}$/);

    // What Stripe was asked for: our price in fils, our ids only (no story or child details).
    const [sent] = fakeStripe.sessions;
    expect(sent.amountFils).toBe(config.payments.prices.digital * 100);
    expect(sent.productName).toBe("Dream Builder Digital Storybook");
    expect(sent.customerEmail).toBe(parent.email);
    expect(sent.successUrl).toBe(`${config.appUrl}/checkout/success?order=${res.body.order.id}`);
    expect(JSON.stringify(sent)).not.toContain("Ember");

    expect(await AuditLog.countDocuments({ action: "order.create", targetId: res.body.order.id, actorId: parent.id })).toBe(1);
  });

  it("a price changed in the browser request is refused; the charge always matches server config", async () => {
    const { parent, storyId } = await family();
    for (const extra of [{ price: 1 }, { amount: 1 }, { amountFils: 100 }]) {
      const res = await checkout(parent.token, { storyId, tier: "digital", ...extra });
      expect(res.status).toBe(400);
    }
    expect(fakeStripe.sessions).toHaveLength(0);
    await checkout(parent.token, { storyId, tier: "hardback", deliveryAddress: ADDRESS });
    expect(fakeStripe.sessions[0].amountFils).toBe((config.payments.prices.hardback + config.payments.delivery.hardback) * 100);
  });

  it("only an approved story, only by its own parent", async () => {
    const notYet = await family("parent_review");
    const refused = await checkout(notYet.parent.token, { storyId: notYet.storyId, tier: "digital" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("STORY_LOCKED");

    const { parent, childId, storyId } = await family();
    const stranger = await makeUser("parent");
    expect((await checkout(stranger.token, { storyId, tier: "digital" })).status).toBe(404);
    expect((await checkout(parent.token, { storyId: "nonsense", tier: "digital" })).status).toBe(400);

    // A child, a facilitator and an unverified parent can't buy.
    const child = await makeChildSession(parent.id, childId);
    expect((await checkout(child, { storyId, tier: "digital" })).status).toBe(403);
    const facilitator = await makeUser("facilitator");
    await linkToChild(facilitator.id, childId);
    expect((await checkout(facilitator.token, { storyId, tier: "digital" })).status).toBe(403);
    expect(await Order.countDocuments({ storyId })).toBe(0);
  });

  it("a hardback needs a UAE delivery address; a digital book has none", async () => {
    const { parent, storyId } = await family();
    expect((await checkout(parent.token, { storyId, tier: "hardback" })).status).toBe(400);
    expect((await checkout(parent.token, { storyId, tier: "hardback", deliveryAddress: { ...ADDRESS, emirate: "Paris" } })).status).toBe(400);
    expect((await checkout(parent.token, { storyId, tier: "digital", deliveryAddress: ADDRESS })).status).toBe(400);

    const res = await checkout(parent.token, { storyId, tier: "hardback", deliveryAddress: ADDRESS });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ printStatus: "not_ready", deliveryAddress: { ...ADDRESS, country: "AE" } });
  });

  it("tapping Pay again reuses the unpaid order with a fresh page, and closes the old page", async () => {
    const { parent, storyId } = await family();
    const first = await checkout(parent.token, { storyId, tier: "digital" });
    const second = await checkout(parent.token, { storyId, tier: "digital" });
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(second.body.checkoutUrl).not.toBe(first.body.checkoutUrl);
    expect(fakeStripe.sessions.map((s) => s.expired)).toEqual([true, false]);
    expect(await Order.countDocuments({ storyId })).toBe(1);
    expect((await orderOf(first.body.order.id)).stripeSessionIds).toHaveLength(2);
  });

  it("when Stripe can't be reached: 503, and trying again works", async () => {
    const { parent, storyId } = await family();
    fakeStripe.failNext = true;
    const res = await checkout(parent.token, { storyId, tier: "digital" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("PAYMENTS_NOT_READY");
    expect((await checkout(parent.token, { storyId, tier: "digital" })).status).toBe(201);
    expect(await Order.countDocuments({ storyId })).toBe(1);
  });
});

describe("BE-17 the Stripe webhook", () => {
  it("marks the order paid, puts a hardback in the print queue, and writes one audit entry", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "hardback", deliveryAddress: ADDRESS })).body.order.id as string;
    const res = await webhook("checkout.session.completed", await paidSession(id)).send();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const order = await orderOf(id);
    expect(order).toMatchObject({ paymentStatus: "paid", printStatus: "waiting", stripePaymentIntentId: "pi_test_123" });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(await paidAudits(id)).toBe(1);

    // The parent's screen sees it.
    const seen = await request(app).get(`/api/v1/orders/${id}`).set(bearer(parent.token));
    expect(seen.body.order.paymentStatus).toBe("paid");
  });

  it("a repeated or out-of-order webhook never changes a paid order twice", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    const session = await paidSession(id);
    const completed = webhook("checkout.session.completed", session);
    await completed.send();
    const paidAt = (await orderOf(id)).paidAt;

    // The same event again (Stripe retries), a second "completed", then a late "expired".
    expect((await completed.send()).status).toBe(200);
    await webhook("checkout.session.completed", session).send();
    await webhook("checkout.session.expired", { ...session, payment_status: "unpaid" }).send();
    await webhook("checkout.session.async_payment_failed", session).send();

    const order = await orderOf(id);
    expect(order.paymentStatus).toBe("paid");
    expect(order.paidAt).toEqual(paidAt);
    expect(await paidAudits(id)).toBe(1);
    expect(await StripeEvent.countDocuments({ eventId: completed.eventId })).toBe(1);
  });

  it("refuses a missing or wrong signature (400) and changes nothing", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    const payload = JSON.stringify({ id: "evt_fake", object: "event", type: "checkout.session.completed", data: { object: await paidSession(id) } });
    const url = "/api/v1/payments/stripe/webhook";
    const noSig = await request(app).post(url).set("Content-Type", "application/json").send(payload);
    expect(noSig.status).toBe(400);
    expect(noSig.body.error.code).toBe("WEBHOOK_INVALID");
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_elses_secret" });
    expect((await request(app).post(url).set("Content-Type", "application/json").set("Stripe-Signature", forged).send(payload)).status).toBe(400);
    expect((await orderOf(id)).paymentStatus).toBe("pending");
  });

  it("a charge that doesn't match the order (amount or currency) is not marked paid", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    await webhook("checkout.session.completed", await paidSession(id, { amount_total: 100 })).send();
    await webhook("checkout.session.completed", await paidSession(id, { currency: "usd" })).send();
    expect((await orderOf(id)).paymentStatus).toBe("pending");
  });

  it("an expired page cancels the order; paying later starts a new one", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    await webhook("checkout.session.expired", await paidSession(id, { payment_status: "unpaid" })).send();
    expect((await orderOf(id)).paymentStatus).toBe("cancelled");
    const again = await checkout(parent.token, { storyId, tier: "digital" });
    expect(again.status).toBe(201);
    expect(again.body.order.id).not.toBe(id);
  });

  it("a payment on an OLD page of the order still counts; that page's expiry doesn't cancel it", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    const oldSession = await paidSession(id);
    await checkout(parent.token, { storyId, tier: "digital" }); // a fresh page
    await webhook("checkout.session.expired", { ...oldSession, payment_status: "unpaid" }).send();
    expect((await orderOf(id)).paymentStatus).toBe("pending");
    await webhook("checkout.session.completed", oldSession).send();
    expect((await orderOf(id)).paymentStatus).toBe("paid");
  });

  it("a slow payment method waits for its result; a failure marks the order failed", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    const session = await paidSession(id, { payment_status: "unpaid" });
    await webhook("checkout.session.completed", session).send();
    expect((await orderOf(id)).paymentStatus).toBe("pending");
    await webhook("checkout.session.async_payment_failed", session).send();
    expect((await orderOf(id)).paymentStatus).toBe("failed");
  });

  it("a story already bought in that format can't be bought again; other events are ignored", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    await webhook("checkout.session.completed", await paidSession(id)).send();
    const again = await checkout(parent.token, { storyId, tier: "digital" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_BOUGHT");
    // A hardback of the same story is still possible.
    expect((await checkout(parent.token, { storyId, tier: "hardback", deliveryAddress: ADDRESS })).status).toBe(201);
    // An event type we don't use: 200, nothing changes.
    expect((await webhook("customer.created", { id: "cus_123" }).send()).status).toBe(200);
  });
});

describe("BE-17 privacy and access", () => {
  it("card details never reach us: only Stripe ids are stored", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    await webhook("checkout.session.completed", await paidSession(id, { customer_details: { email: parent.email } })).send();
    const order = await orderOf(id);
    const stored = JSON.stringify(order);
    expect(stored).not.toMatch(/card|cvc|4242|exp_month/i);
    expect(order.stripeSessionId).toMatch(/^cs_test_/);
    expect(order.stripePaymentIntentId).toMatch(/^pi_/);
    // And the API doesn't hand Stripe's ids to the browser.
    const seen = await request(app).get(`/api/v1/orders/${id}`).set(bearer(parent.token));
    expect(JSON.stringify(seen.body)).not.toMatch(/cs_test_|pi_test_/);
  });

  it("another parent's order is 404; a bad id is 404", async () => {
    const { parent, storyId } = await family();
    const id = (await checkout(parent.token, { storyId, tier: "digital" })).body.order.id as string;
    const stranger = await makeUser("parent");
    expect((await request(app).get(`/api/v1/orders/${id}`).set(bearer(stranger.token))).status).toBe(404);
    expect((await request(app).get("/api/v1/orders/not-an-id").set(bearer(parent.token))).status).toBe(404);
    const mine = await request(app).get(`/api/v1/orders?storyId=${storyId}`).set(bearer(parent.token));
    expect(mine.body.orders.map((o: { id: string }) => o.id)).toEqual([id]);
    expect((await request(app).get("/api/v1/orders").set(bearer(stranger.token))).body.orders).toEqual([]);
  });
});
