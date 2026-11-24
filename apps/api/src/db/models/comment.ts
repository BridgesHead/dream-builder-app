import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions } from "../schemaOptions.js";

// "comment" = a note for the child. "change_request" = a note that also sends the story
// back to child_review (BE-12).
export const COMMENT_TYPES = ["comment", "change_request"] as const;

// A parent's comment on a story (BE-12). Stored apart from the child's text, so a
// comment can never change panel text.
const commentSchema = new Schema(
  {
    // index: "all comments on this story" is how the review screens read them.
    storyId: { type: Schema.Types.ObjectId, ref: "Story", required: true, index: true },
    // Which panel it is about; null = about the whole story.
    panelNumber: { type: Number, min: 1, max: 15, default: null },
    // Who wrote it (and when: the createdAt timestamp).
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: COMMENT_TYPES, required: true, default: "comment" },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  baseSchemaOptions,
);

export type CommentFields = InferSchemaType<typeof commentSchema>;
export const Comment = model("Comment", commentSchema);
