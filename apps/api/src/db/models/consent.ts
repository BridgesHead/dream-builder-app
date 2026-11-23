import { model, Schema, type InferSchemaType } from "mongoose";
import { appendOnlySchemaOptions, makeAppendOnly } from "../schemaOptions.js";

// How the consent was given. Release 1 uses email verification plus this stored record
// (guide BE-03, pending legal review). New methods are added here when they arrive.
export const CONSENT_METHODS = ["email_verification"] as const;

// A parent's recorded consent (guide BE-03): who, when, IP address, consent text version
// and method. A new consent text version ADDS a record; old records are never changed.
const consentSchema = new Schema(
  {
    // Who: the parent.
    parentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Which version of the consent text they agreed to, e.g. "2026-11-v1".
    textVersion: { type: String, required: true, trim: true, maxlength: 50 },
    method: { type: String, enum: CONSENT_METHODS, required: true },
    // From where. 45 characters fits the longest IPv6 address.
    ipAddress: { type: String, required: true, maxlength: 45 },
    // When: the createdAt timestamp Mongoose adds.
  },
  appendOnlySchemaOptions,
);

makeAppendOnly(consentSchema, "Consent");

export type ConsentFields = InferSchemaType<typeof consentSchema>;
export const Consent = model("Consent", consentSchema);
