import { model, Schema, type InferSchemaType } from "mongoose";
import { modeForAge } from "../../lib/mode.js";
import { MODES } from "../../types/story.js";

import { baseSchemaOptions } from "../schemaOptions.js";

// A child profile, owned by one parent. Field names follow ChildProfile in the frontend.
const childSchema = new Schema(
  {
    // The owner. Always taken from the logged-in parent, never from the request body.
    // index: every "my children" query filters by parentId.
    parentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    // Dream Builder is for ages 8–14 (guide BE-04). Whole years only.
    age: {
      type: Number,
      required: true,
      min: 8,
      max: 14,
      validate: { validator: Number.isInteger, message: "age must be a whole number" },
    },
    // As the frontend stores it, e.g. "English".
    language: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    // Explorer or Creator. If the parent doesn't choose, it defaults from age.
    // A function default runs after the other fields are set, so `this.age` is known here.
    mode: {
      type: String,
      enum: MODES,
      required: true,
      default(this: { age?: number }) {
        return typeof this.age === "number" ? modeForAge(this.age) : undefined;
      },
    },
    // Soft delete (BE-04): set when the parent removes the child. The profile is hidden
    // but kept until the full deletion workflow (BE-16).
    deletedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

export type ChildFields = InferSchemaType<typeof childSchema>;
export const Child = model("Child", childSchema);
