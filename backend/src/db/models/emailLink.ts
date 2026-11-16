import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../schemaOptions.js";

export const EMAIL_LINK_PURPOSES = ["verify_email", "reset_password"] as const;
export type EmailLinkPurpose = (typeof EMAIL_LINK_PURPOSES)[number];

// A single-use link we emailed (guide BE-03): "verify your email" or "reset your password".
// The email holds the token; we keep only its hash.
const emailLinkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: EMAIL_LINK_PURPOSES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    // 24 hours after it was made.
    expiresAt: { type: Date, required: true },
    // When it was used. Set once; a used link never works again.
    usedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

// MongoDB deletes each link 7 days after it expires. Until then we keep it, so an old link
// gets the clear answer "already used" or "expired" instead of "never heard of it".
emailLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export type EmailLinkFields = InferSchemaType<typeof emailLinkSchema>;
export const EmailLink = model("EmailLink", emailLinkSchema);
