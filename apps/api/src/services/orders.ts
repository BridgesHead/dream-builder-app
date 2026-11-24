import { randomInt } from "node:crypto";
import { isValidObjectId, type Types } from "mongoose";
import type Stripe from "stripe";
import { config } from "../config.js";
import { Order, StripeEvent, type OrderTier } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { getPaymentProvider } from "../payments/provider.js";
import { writeAudit } from "./audit.js";
import { findReachableStory } from "./stories.js";

// Orders and Stripe Checkout (guide BE-17).
//
//   POST /orders     story approved and the caller's? → price from OUR config → order (pending)
//                    → a Stripe Checkout page → the browser goes there
//   the webhook      Stripe says "paid" → order paid (once, ever) → audit "order.paid"
//                    → a hardback joins the print queue (printStatus "waiting", BE-18/19)
//
// The browser never sends a price: the request schema has no price field, and the amount
// always comes from config.payments.

/** What the parent sees for each book type, e.g. on the plans screen. */
const PRODUCT_NAMES: Record<OrderTier, string> = {
  digital: "Dream Builder Digital Storybook",
  hardback: "Dream Builder Premium Hardback",
};

/** AED → fils (what Stripe counts in): 149 → 14900. */
const toFils = (aed: number) => Math.round(aed * 100);

/** The total for one book type, in fils, from the server's config only. */
export function priceFils(tier: OrderTier): number {
  return toFils(config.payments.prices[tier] + config.payments.delivery[tier]);
}

/** GET /orders/prices: the prices the plans screen shows (in AED). */
export function listPrices() {
  return {
    currency: "AED",
    tiers: (["digital", "hardback"] as const).map((tier) => ({
      tier,
      name: PRODUCT_NAMES[tier],
      price: config.payments.prices[tier],
      delivery: config.payments.delivery[tier],
      total: priceFils(tier) / 100,
    })),
  };
}

type OrderDoc = NonNullable<Awaited<ReturnType<typeof Order.findOne>>>;
type OrderLike = Pick<
  OrderDoc,
  "orderNumber" | "storyId" | "tier" | "amountFils" | "amountPaidFils" | "discountFils" | "promoCode" | "paymentStatus" | "printStatus" | "deliveryAddress" | "paidAt" | "createdAt"
> & {
  _id: unknown;
};

/** What the API sends about an order: no Stripe ids, no parent id. */
function orderView(o: OrderLike) {
  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    storyId: String(o.storyId),
    tier: o.tier,
    // The full price, then (once paid) what was actually paid and any promo code's discount.
    amount: o.amountFils / 100,
    amountPaid: o.amountPaidFils == null ? null : o.amountPaidFils / 100,
    discount: (o.discountFils ?? 0) / 100,
    promoCode: o.promoCode ?? null,
    currency: "AED",
    paymentStatus: o.paymentStatus,
    printStatus: o.printStatus,
    deliveryAddress: o.deliveryAddress ?? null,
    paidAt: o.paidAt ?? null,
    createdAt: o.createdAt,
  };
}

export interface DeliveryAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  emirate: string;
  postalCode?: string;
}

export interface ParentBuyer {
  parentId: string;
  email: string;
  ip?: string | null;
}

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/** A fresh "DB-123456" that no other order has. */
async function newOrder(fields: Record<string, unknown>) {
  for (let tries = 0; ; tries += 1) {
    try {
      return await Order.create({ ...fields, orderNumber: `DB-${randomInt(100_000, 1_000_000)}` });
    } catch (err) {
      // The same number twice (rare): pick another. A second pending order: the caller handles it.
      const numberTaken = isDuplicateKey(err) && String((err as { message?: string }).message).includes("orderNumber");
      if (!numberTaken || tries >= 5) throw err;
    }
  }
}

/**
 * POST /orders: an order for an approved story, and the Stripe page to pay it on.
 * Tapping "Pay" again reuses the same unpaid order with a fresh page (the old page is closed).
 */
export async function startCheckout(buyer: ParentBuyer, input: { storyId: string; tier: OrderTier; deliveryAddress?: DeliveryAddress }) {
  // Only the story's own parent (404 for anyone else), and only once it's approved.
  const story = await findReachableStory({ kind: "parent", parentId: buyer.parentId }, input.storyId);
  if (story.status !== "approved") throw new AppError(409, "STORY_LOCKED", "Only an approved story can be bought");
  if (await Order.exists({ storyId: story._id, tier: input.tier, paymentStatus: "paid" })) {
    throw new AppError(409, "ALREADY_BOUGHT", "You've already bought this story in this format");
  }
  const provider = getPaymentProvider(); // 503 if Stripe isn't set up here

  const fields = {
    parentId: buyer.parentId,
    storyId: story._id,
    tier: input.tier,
    // Always the server's price, at the moment of ordering.
    amountFils: priceFils(input.tier),
    deliveryAddress: input.tier === "hardback" ? { ...input.deliveryAddress, country: "AE" } : null,
  };

  let order = await Order.findOne({ storyId: story._id, tier: input.tier, paymentStatus: "pending" });
  let created = false;
  if (order) {
    // Same story and book: keep the order, take the latest address and price.
    order.set({ amountFils: fields.amountFils, deliveryAddress: fields.deliveryAddress });
    await order.save();
  } else {
    try {
      order = await newOrder({ ...fields, printStatus: input.tier === "hardback" ? "not_ready" : "not_needed" });
      created = true;
    } catch (err) {
      // Another tap made the pending order a moment ago: use that one.
      if (!isDuplicateKey(err)) throw err;
      order = await Order.findOne({ storyId: story._id, tier: input.tier, paymentStatus: "pending" });
      if (!order) throw err;
    }
  }
  const orderId = String(order._id);

  let checkout: { sessionId: string; url: string };
  try {
    checkout = await provider.createCheckout({
      orderId,
      orderNumber: order.orderNumber,
      amountFils: order.amountFils,
      productName: PRODUCT_NAMES[input.tier],
      customerEmail: buyer.email,
      successUrl: `${config.appUrl}/checkout/success?order=${orderId}`,
      cancelUrl: `${config.appUrl}/checkout/pay?plan=${input.tier}&order=${orderId}&cancelled=1`,
      expiresAt: new Date(Date.now() + config.payments.checkoutExpiresMinutes * 60_000),
      allowPromotionCodes: config.payments.promoCodesEnabled,
      // One key per page of this order: a resent request gets the same page, not a second one.
      idempotencyKey: `order-${orderId}-page-${order.stripeSessionIds.length + 1}-${order.amountFils}`,
    });
  } catch (err) {
    logger.error({ orderId, reason: err instanceof Error ? err.message : String(err) }, "Could not create a Stripe Checkout page");
    throw new AppError(503, "PAYMENTS_NOT_READY", "We couldn't open the payment page. Please try again.");
  }

  // Close the parent's older payment page for this order, so only one stays open.
  const older = order.stripeSessionId;
  await Order.updateOne(
    { _id: order._id },
    { $set: { stripeSessionId: checkout.sessionId }, $addToSet: { stripeSessionIds: checkout.sessionId } },
  );
  if (older && older !== checkout.sessionId) {
    await provider.expireCheckout(older).catch((err: unknown) => {
      // Already paid or expired: fine. A payment on it would still count (see the webhook).
      logger.info({ orderId, reason: err instanceof Error ? err.message : String(err) }, "Older checkout page not closed");
    });
  }
  if (created) {
    await writeAudit({ actorId: buyer.parentId, actorRole: "parent", action: "order.create", targetType: "order", targetId: orderId, ipAddress: buyer.ip });
  }
  return { order: orderView(order), checkoutUrl: checkout.url };
}

/** GET /orders/:id: one of the caller's orders (404 for anyone else's). */
export async function getOrder(parentId: string, orderId: string) {
  if (!isValidObjectId(orderId)) throw new AppError(404, "NOT_FOUND", "Order not found");
  const order = await Order.findOne({ _id: orderId, parentId }).lean();
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");
  return orderView(order);
}

/** GET /orders: the caller's orders, newest first (optionally for one story). */
export async function listOrders(parentId: string, storyId?: string) {
  if (storyId !== undefined && !isValidObjectId(storyId)) return [];
  const orders = await Order.find({ parentId, ...(storyId && { storyId }) }).sort({ createdAt: -1 }).lean();
  return orders.map(orderView);
}

// ---- The Stripe webhook -------------------------------------------------------------------------

type Session = Stripe.Checkout.Session;

/** The order a Checkout Session belongs to: by our id in its metadata AND its session id. */
async function orderForSession(session: Session) {
  const orderId = session.metadata?.orderId ?? session.client_reference_id;
  if (!orderId || !isValidObjectId(orderId)) return null;
  return Order.findOne({ _id: orderId, stripeSessionIds: session.id });
}

async function markPaid(session: Session, eventId: string) {
  const order = await orderForSession(session);
  if (!order) {
    logger.warn({ eventId, sessionId: session.id }, "Stripe webhook for an unknown order; ignored");
    return null;
  }
  // The charge must match what we asked for, in AED: our amount, or our amount minus a real
  // promo code's discount (Stripe lists the code in `discounts`). Anything else is refused.
  const paid = session.amount_total ?? -1;
  const discount = session.total_details?.amount_discount ?? 0;
  const promo = session.discounts?.find((d) => d.promotion_code)?.promotion_code ?? null;
  const promoId = typeof promo === "string" ? promo : (promo?.id ?? null);
  const fits = paid >= 0 && paid + discount === order.amountFils && (discount === 0 || (session.discounts?.length ?? 0) > 0);
  if (!fits || session.currency !== "aed") {
    logger.error(
      { eventId, orderId: String(order._id), expected: order.amountFils, got: session.amount_total, discount, currency: session.currency },
      "Stripe amount doesn't match the order; not marked paid",
    );
    return order._id;
  }
  // The words the parent typed ("TEST20"), for the order page and support. Best effort.
  let promoCode = typeof promo === "object" && promo ? promo.code : null;
  if (!promoCode && promoId) {
    try {
      promoCode = await getPaymentProvider().promotionCodeText(promoId);
    } catch (err) {
      logger.warn({ orderId: String(order._id), reason: err instanceof Error ? err.message : String(err) }, "Could not read the promo code's words");
    }
  }
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  // From any unpaid status to paid, ONCE: a paid order never changes again, whatever arrives later.
  const moved = await Order.updateOne(
    { _id: order._id, paymentStatus: { $ne: "paid" } },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: new Date(),
        stripePaymentIntentId: paymentIntent,
        amountPaidFils: paid,
        discountFils: discount,
        promoCode,
        stripePromotionCodeId: promoId,
        // A paid hardback joins the print queue (BE-18, BE-19).
        ...(order.tier === "hardback" && { printStatus: "waiting" }),
      },
    },
  );
  if (moved.modifiedCount > 0) {
    await writeAudit({ actorId: null, actorRole: "system", action: "order.paid", targetType: "order", targetId: String(order._id) });
    logger.info({ orderId: String(order._id), orderNumber: order.orderNumber, tier: order.tier, paidFils: paid, discountFils: discount }, "Order paid");
  }
  return order._id;
}

/** Failed or expired: only for the order's CURRENT page, and only while still pending. */
async function markUnpaid(session: Session, to: "failed" | "cancelled") {
  const order = await orderForSession(session);
  if (!order) return null;
  await Order.updateOne({ _id: order._id, paymentStatus: "pending", stripeSessionId: session.id }, { $set: { paymentStatus: to } });
  return order._id;
}

/**
 * One webhook event from Stripe (already signature-checked). Each event is handled once:
 * a repeat is skipped, and an out-of-order one can't undo "paid".
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<"handled" | "duplicate" | "ignored"> {
  if (await StripeEvent.exists({ eventId: event.id })) return "duplicate";

  let orderId: Types.ObjectId | null = null;
  let outcome: "handled" | "ignored" = "handled";
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // "unpaid" = a slow method (e.g. a bank transfer) still on its way: async_payment_* follows.
      // "no_payment_required" = a 100%-off promo code made it free: that counts as paid.
      if (session.payment_status === "paid" || session.payment_status === "no_payment_required") orderId = await markPaid(session, event.id);
      else orderId = (await orderForSession(session))?._id ?? null;
      break;
    }
    case "checkout.session.async_payment_succeeded":
      orderId = await markPaid(event.data.object, event.id);
      break;
    case "checkout.session.async_payment_failed":
      orderId = await markUnpaid(event.data.object, "failed");
      break;
    case "checkout.session.expired":
      orderId = await markUnpaid(event.data.object, "cancelled");
      break;
    default:
      outcome = "ignored"; // an event we don't use (Stripe sends many kinds)
  }

  try {
    await StripeEvent.create({ eventId: event.id, type: event.type, orderId });
  } catch (err) {
    // The same event handled at the same moment by another server: already done.
    if (!isDuplicateKey(err)) throw err;
    return "duplicate";
  }
  return outcome;
}
