import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../schemaOptions.js";

// Grown-up accounts. Children never get an account: they use a child session (BE-04).
export const USER_ROLES = ["parent", "facilitator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userSchema = new Schema(
  {
    // Saved lowercase, so "Ali@Example.com" and "ali@example.com" are the same account.
    // unique: MongoDB itself refuses a second account with the same email.
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    // The argon2 hash, never the password. select: false = left out of every query
    // unless the code asks for it by name (only login needs it).
    passwordHash: { type: String, required: true, select: false },
    // Admins are created only by a script, never through sign-up (BE-05).
    role: { type: String, enum: USER_ROLES, required: true, default: "parent" },
    // When the parent clicked the verification link. null = not verified yet,
    // and an unverified parent cannot create child profiles (BE-03).
    emailVerifiedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

export type UserFields = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);
