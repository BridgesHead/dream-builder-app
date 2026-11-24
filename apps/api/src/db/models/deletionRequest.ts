import { model, Schema, type InferSchemaType } from "mongoose";
import { baseSchemaOptions, subdocumentOptions } from "../schemaOptions.js";

// A parent's request to delete one child's data (guide BE-16). Kept after it finishes, as the
// record that the deletion happened. It holds ids and counts only: never names, never story
// content (the child's name is gone with the child).
//
//   queued ──► running ──► done
//     │           └──────► failed   (every try failed; a retry can run it again safely)
//     └─► waiting_for_print         (a paid hardback is still being printed: checked again
//                                    every DELETION_PRINT_CHECK_MINUTES until it ships)
export const DELETION_STATUSES = ["queued", "waiting_for_print", "running", "done", "failed"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

// How much was deleted, per kind (also what the preview shows before it starts).
const countsSchema = new Schema(
  {
    stories: { type: Number, min: 0, default: 0 },
    comments: { type: Number, min: 0, default: 0 },
    jobs: { type: Number, min: 0, default: 0 },
    files: { type: Number, min: 0, default: 0 }, // pictures, redraws, voice recordings, print files
    sessions: { type: Number, min: 0, default: 0 },
    facilitatorLinks: { type: Number, min: 0, default: 0 },
    // Kept (payment records), with the delivery address removed.
    ordersKept: { type: Number, min: 0, default: 0 },
  },
  subdocumentOptions,
);

const deletionRequestSchema = new Schema(
  {
    // Always the logged-in parent who asked.
    parentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // The child being deleted. After the deletion this id points at nothing: it's only a label.
    childId: { type: Schema.Types.ObjectId, required: true, index: true },
    // The child's stories when the request was made (ids only). Kept so a retry still knows
    // which files and payment records to clean, even after the stories themselves are gone.
    storyIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: DELETION_STATUSES, required: true, default: "queued" },
    // Where the confirmation email goes (the parent's address when they asked).
    notifyEmail: { type: String, required: true, maxlength: 254 },
    counts: { type: countsSchema, default: () => ({}) },
    attempts: { type: Number, min: 0, default: 0 },
    // A short, safe reason when a try failed (never story content).
    lastError: { type: String, maxlength: 500, default: null },
    // How many times we've checked whether the printed book has shipped.
    printChecks: { type: Number, min: 0, default: 0 },
    finishedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

export type DeletionRequestFields = InferSchemaType<typeof deletionRequestSchema>;
export const DeletionRequest = model("DeletionRequest", deletionRequestSchema);
