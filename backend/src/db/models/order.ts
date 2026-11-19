import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions, subdocumentOptions } from "../schemaOptions.js";

// One purchase of one story (guide BE-17): a digital PDF or a printed hardback, paid in AED
// through Stripe Checkout. Card details never reach us: only Stripe's IDs are stored.

// The book types the guide sells. (The prototype's "softcover" is not one of them.)
export const ORDER_TIERS = ["digital", "hardback"] as const;
export type OrderTier = (typeof ORDER_TIERS)[number];

//   pending ──► paid        (Stripe confirmed it; final, never changes again)
//      ├──────► failed      (a slow payment method, e.g. a bank transfer, didn't go through)
//      └──────► cancelled   (the payment page expired, or a newer checkout replaced it)
export const PAYMENT_STATUSES = ["pending", "paid", "failed", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// What happens to the printed book (BE-18 makes the print file, BE-19 sends it to the publisher).
//   not_needed  a digital order
//   not_ready   a hardback that isn't paid yet
//   waiting     paid, in the print queue
export const PRINT_STATUSES = ["not_needed", "not_ready", "waiting", "file_ready", "sent", "printed", "shipped", "delivered", "problem"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];

// The 7 emirates, for the hardback delivery address.
export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] as const;

const addressSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200, default: "" },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    emirate: { type: String, enum: EMIRATES, required: true },
    postalCode: { type: String, trim: true, maxlength: 20, default: "" },
    country: { type: String, enum: ["AE"], required: true, default: "AE" },
  },
  subdocumentOptions,
);

const orderSchema = new Schema(
  {
    // e.g. "DB-482913": what the parent and support see.
    orderNumber: { type: String, required: true, unique: true, maxlength: 20 },
    // Always the logged-in parent (never from the request body).
    parentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    storyId: { type: Schema.Types.ObjectId, ref: "Story", required: true },
    tier: { type: String, enum: ORDER_TIERS, required: true },
    // The price from OUR config when the order was made, in fils (AED × 100, as Stripe counts).
    amountFils: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["aed"], required: true, default: "aed" },
    // Hardback only.
    deliveryAddress: { type: addressSchema, default: null },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true, default: "pending" },
    printStatus: { type: String, enum: PRINT_STATUSES, required: true },
    // Stripe's IDs, never card details. The current Checkout Session, plus any earlier ones for
    // this order (a parent who taps Pay again gets a fresh page; a payment on an old one still counts).
    stripeSessionId: { type: String, maxlength: 255, default: null },
    stripeSessionIds: { type: [{ type: String, maxlength: 255 }], default: [] },
    stripePaymentIntentId: { type: String, maxlength: 255, default: null },
    paidAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

// A parent's orders, newest first.
orderSchema.index({ parentId: 1, createdAt: -1 });
// At most ONE unpaid order per story and book type: two taps on "Pay" can't make two.
orderSchema.index({ storyId: 1, tier: 1 }, { unique: true, partialFilterExpression: { paymentStatus: "pending" } });
// The webhook finds the order by its Checkout Session.
orderSchema.index({ stripeSessionIds: 1 });

export type OrderFields = InferSchemaType<typeof orderSchema>;
export const Order = model("Order", orderSchema);
