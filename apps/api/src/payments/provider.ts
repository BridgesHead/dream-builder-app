import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

// Who takes the payment (guide BE-17). The same idea as the AI providers (BE-10):
//
//   STRIPE_SECRET_KEY set   the real Stripe (test mode on your PC, dev and staging)
//   tests (no key)          a fake Stripe that only remembers what it was asked
//
// Either way the CARD never reaches our server: the parent types it on Stripe's own page.
// Webhooks are always checked with Stripe's real signature check (STRIPE_WEBHOOK_SECRET).

export interface CheckoutRequest {
  orderId: string;
  orderNumber: string;
  amountFils: number;
  /** What the parent sees on Stripe's page, e.g. "Dream Builder Premium Hardback". */
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  /** Shows Stripe's "Add promotion code" box (the codes are made in the Stripe dashboard). */
  allowPromotionCodes: boolean;
  /** Same key = Stripe makes the page only once, even if our request is sent twice. */
  idempotencyKey: string;
}

export interface PaymentProvider {
  name: "stripe" | "fake";
  /** A Stripe Checkout page for one order. */
  createCheckout(req: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  /** Closes an old payment page (when the parent starts a new one). Best effort. */
  expireCheckout(sessionId: string): Promise<void>;
  /** The words of a promo code ("TEST20") from Stripe's id for it ("promo_…"). */
  promotionCodeText(promotionCodeId: string): Promise<string | null>;
  /**
   * A Checkout page as Stripe sees it now (paid or not), the same object the webhook carries.
   * For when the webhook is late or never comes (see orders.ts syncWithStripe).
   */
  retrieveCheckout(sessionId: string): Promise<Stripe.Checkout.Session>;
}

// ---- The real Stripe ----------------------------------------------------------------------

let client: Stripe | null = null;
function stripeClient(key: string): Stripe {
  // Retries a failed network call twice; Stripe's idempotency key makes that safe.
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

function stripeProvider(key: string): PaymentProvider {
  return {
    name: "stripe",
    async createCheckout(req) {
      const session = await stripeClient(key).checkout.sessions.create(
        {
          mode: "payment",
          // No payment_method_types: Stripe shows what the dashboard has switched on
          // (cards, Apple Pay and Google Pay), and 3-D Secure when the bank asks for it.
          line_items: [
            {
              quantity: 1,
              price_data: { currency: "aed", unit_amount: req.amountFils, product_data: { name: req.productName } },
            },
          ],
          customer_email: req.customerEmail,
          client_reference_id: req.orderId,
          // Only our ids: no child names or story text go to Stripe.
          metadata: { orderId: req.orderId, orderNumber: req.orderNumber },
          payment_intent_data: { metadata: { orderId: req.orderId, orderNumber: req.orderNumber } },
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          expires_at: Math.floor(req.expiresAt.getTime() / 1000),
          // Stripe checks the code (expired, used up, wrong) and lowers the total itself.
          ...(req.allowPromotionCodes && { allow_promotion_codes: true }),
        },
        { idempotencyKey: req.idempotencyKey },
      );
      if (!session.url) throw new Error("Stripe gave no checkout page");
      return { sessionId: session.id, url: session.url };
    },
    async expireCheckout(sessionId) {
      await stripeClient(key).checkout.sessions.expire(sessionId);
    },
    async promotionCodeText(promotionCodeId) {
      return (await stripeClient(key).promotionCodes.retrieve(promotionCodeId)).code;
    },
    async retrieveCheckout(sessionId) {
      // The promo code comes with it, so a discounted payment is recorded with its code.
      return stripeClient(key).checkout.sessions.retrieve(sessionId, { expand: ["discounts.promotion_code"] });
    },
  };
}

// ---- The fake Stripe (tests only) -----------------------------------------------------------

/** What the fake was asked, so tests can check it (e.g. the amount sent). */
export const fakeStripe = {
  /** `paid`: a test sets it to pretend the parent paid on that page (no webhook needed). */
  sessions: [] as (CheckoutRequest & { sessionId: string; expired: boolean; paid?: boolean })[],
  failNext: false,
  /** Promo codes the fake knows: Stripe's id → the words the parent typed. */
  promotionCodes: {} as Record<string, string>,
  /** How many times the server looked a page up (retrieveCheckout). */
  lookups: 0,
  reset(): void {
    this.sessions = [];
    this.failNext = false;
    this.promotionCodes = {};
    this.lookups = 0;
  },
};

const fakeProvider: PaymentProvider = {
  name: "fake",
  async createCheckout(req) {
    if (fakeStripe.failNext) {
      fakeStripe.failNext = false;
      throw new Error("The fake Stripe failed on purpose");
    }
    const sessionId = `cs_test_fake_${randomUUID().replaceAll("-", "")}`;
    fakeStripe.sessions.push({ ...req, sessionId, expired: false });
    return { sessionId, url: `https://checkout.stripe.test/c/pay/${sessionId}` };
  },
  async expireCheckout(sessionId) {
    const s = fakeStripe.sessions.find((x) => x.sessionId === sessionId);
    if (s) s.expired = true;
  },
  async promotionCodeText(promotionCodeId) {
    return fakeStripe.promotionCodes[promotionCodeId] ?? null;
  },
  async retrieveCheckout(sessionId) {
    fakeStripe.lookups += 1;
    const s = fakeStripe.sessions.find((x) => x.sessionId === sessionId);
    if (!s) throw new Error(`No such checkout session: ${sessionId}`);
    // Only the fields our code reads, shaped like Stripe's.
    return {
      id: s.sessionId,
      object: "checkout.session",
      status: s.paid ? "complete" : s.expired ? "expired" : "open",
      payment_status: s.paid ? "paid" : "unpaid",
      amount_total: s.amountFils,
      currency: "aed",
      metadata: { orderId: s.orderId, orderNumber: s.orderNumber },
      client_reference_id: s.orderId,
      payment_intent: s.paid ? `pi_test_fake_${s.sessionId.slice(-8)}` : null,
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      discounts: [],
    } as unknown as Stripe.Checkout.Session;
  },
};

// ---- Choosing one -------------------------------------------------------------------------

export function getPaymentProvider(): PaymentProvider {
  const key = config.payments.stripeSecretKey;
  if (key) return stripeProvider(key);
  if (config.nodeEnv === "test") return fakeProvider;
  throw new AppError(503, "PAYMENTS_NOT_READY", "Payments aren't set up yet. Please try again later.");
}

/**
 * Checks that a webhook really came from Stripe and returns its event. Throws 400 when the
 * signature is missing or wrong (or too old: Stripe's 5-minute replay window).
 * `rawBody` must be the exact bytes Stripe sent, so this route reads the body raw.
 */
export function readStripeWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  const secret = config.payments.stripeWebhookSecret;
  if (!secret) throw new AppError(503, "PAYMENTS_NOT_READY", "Webhooks aren't set up on this server");
  if (!signature) throw new AppError(400, "WEBHOOK_INVALID", "Missing Stripe signature");
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new AppError(400, "WEBHOOK_INVALID", "Invalid Stripe signature");
  }
}
