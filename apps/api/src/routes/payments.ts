import express, { Router } from "express";
import { logger } from "../lib/logger.js";
import { allow } from "../middleware/access.js";
import { readStripeWebhook } from "../payments/provider.js";
import { handleStripeEvent } from "../services/orders.js";

// Stripe's webhook (guide BE-17). Mounted at /api/v1/payments, BEFORE express.json() in
// app.ts: the signature check needs the body exactly as Stripe sent it (raw bytes).
//
//   POST /stripe/webhook   public: Stripe's signature (Stripe-Signature header) is the
//                          permission. A wrong or missing signature gets 400.
//
// Stripe retries any answer that isn't 2xx, for up to 3 days, so a database hiccup here
// (500) is safe: the event comes again, and a repeat is skipped (stripeEvents).

export function createPaymentsRouter(): Router {
  const router = Router();

  router.post("/stripe/webhook", allow("public"), express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const event = readStripeWebhook(body, req.header("stripe-signature"));
    const outcome = await handleStripeEvent(event);
    logger.info({ eventId: event.id, type: event.type, outcome }, "Stripe webhook");
    res.json({ received: true });
    return;
  });

  return router;
}
