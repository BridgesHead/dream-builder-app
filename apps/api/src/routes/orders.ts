import { Router, type Request } from "express";
import { z } from "zod";
import { EMIRATES, ORDER_TIERS } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import * as orders from "../services/orders.js";
import { objectIdString } from "../types/story.js";

// Orders (guide BE-17). Mounted at /api/v1/orders. Parents only (verified, with consent):
// a child session gets 403, and another parent's order or story is 404.
//
//   GET  /prices    the AED prices from server config
//   POST /          { storyId, tier, deliveryAddress? } → { order, checkoutUrl }
//   GET  /          the caller's orders (?storyId=…)
//   GET  /:id       one order (the success screen asks this until it says "paid")

const addressSchema = z
  .object({
    fullName: z.string().trim().min(1, "Please enter a name").max(100),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Please enter a phone number"),
    line1: z.string().trim().min(1, "Please enter an address").max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, "Please enter a city").max(100),
    emirate: z.enum(EMIRATES),
    postalCode: z.string().trim().max(20).optional(),
  })
  .strict();

// .strict(): a "price" or "amount" in the body is refused (400). The price is the server's.
const checkoutSchema = z
  .object({
    storyId: objectIdString,
    tier: z.enum(ORDER_TIERS),
    deliveryAddress: addressSchema.optional(),
  })
  .strict()
  .refine((b) => b.tier !== "hardback" || !!b.deliveryAddress, { path: ["deliveryAddress"], message: "A hardback needs a delivery address" })
  .refine((b) => b.tier !== "digital" || !b.deliveryAddress, { path: ["deliveryAddress"], message: "A digital book has no delivery address" });

const listQuery = z.object({ storyId: z.string().max(100).optional() }).strict();

const buyerOf = (req: Request): orders.ParentBuyer => ({ parentId: req.user!.id, email: req.user!.email, ip: req.ip ?? null });

export function createOrdersRouter(): Router {
  const router = Router();
  const parentOnly = allow("verified_parent");

  router.get("/prices", parentOnly, (_req, res) => {
    res.json(orders.listPrices());
    return;
  });

  router.post("/", parentOnly, validate(checkoutSchema), async (req, res) => {
    res.status(201).json(await orders.startCheckout(buyerOf(req), req.body));
    return;
  });

  router.get("/", parentOnly, async (req, res) => {
    const query = listQuery.safeParse(req.query);
    if (!query.success) {
      throw new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", z.flattenError(query.error).fieldErrors);
    }
    res.json({ orders: await orders.listOrders(req.user!.id, query.data.storyId) });
    return;
  });

  router.get("/:id", parentOnly, async (req, res) => {
    res.json({ order: await orders.getOrder(req.user!.id, String(req.params.id)) });
    return;
  });

  return router;
}
