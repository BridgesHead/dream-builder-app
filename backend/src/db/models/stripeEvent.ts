import { model, Schema, type InferSchemaType } from "mongoose";
import { appendOnlySchemaOptions, makeAppendOnly } from "../schemaOptions.js";

// Every Stripe webhook event we have handled (guide BE-17). Stripe can send the same event
// more than once; the unique eventId means the second copy is noticed and skipped.
const stripeEventSchema = new Schema(
  {
    // e.g. "evt_1Q…". Unique: one row per event, ever.
    eventId: { type: String, required: true, unique: true, maxlength: 255 },
    // e.g. "checkout.session.completed".
    type: { type: String, required: true, maxlength: 100 },
    // Which order it was about, if any.
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
  },
  appendOnlySchemaOptions,
);

makeAppendOnly(stripeEventSchema, "StripeEvent");

export type StripeEventFields = InferSchemaType<typeof stripeEventSchema>;
export const StripeEvent = model("StripeEvent", stripeEventSchema);
