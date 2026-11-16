import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../schemaOptions.js";

// One login on one device: the server side of a refresh token (the "membership card").
// The browser holds the token in a cookie; we keep only its hash, so we can check it
// and cancel it (log out, password reset).
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // SHA-256 of the refresh token. unique: one record per token.
    tokenHash: { type: String, required: true, unique: true },
    // After this moment the refresh token no longer works.
    expiresAt: { type: Date, required: true },
    // "Remember me" was ticked: the cookie survives closing the browser.
    remember: { type: Boolean, required: true },
  },
  baseSchemaOptions,
);

// TTL index: MongoDB deletes each session by itself once expiresAt has passed.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionFields = InferSchemaType<typeof sessionSchema>;
export const Session = model("Session", sessionSchema);
