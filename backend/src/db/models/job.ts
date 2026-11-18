import { model, Schema, type InferSchemaType } from "mongoose";
import { WORK_STATUSES } from "../../types/story.js";
import { baseSchemaOptions, subdocumentOptions } from "../schemaOptions.js";

// The kinds of background work (guide BE-07).
export const JOB_TYPES = [
  "story_text",
  "panel_image",
  "comic_script",
  "comic_cell_image",
  "title",
  "panel_redraw",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

// A story-rule problem the engine found (BE-09). Shown in Book Progress Detail.
//   repaired  = the engine fixed it itself
//   rewritten = the AI rewrote the panel and it passed
//   failed    = still broken after the rewrites (this try failed)
export const VIOLATION_FIXES = ["repaired", "rewritten", "failed"] as const;
const violationSchema = new Schema(
  {
    rule: { type: String, required: true, maxlength: 100 },
    message: { type: String, required: true, maxlength: 1000 },
    panelNumber: { type: Number, min: 1, max: 15, default: null },
    fixedBy: { type: String, enum: VIOLATION_FIXES, required: true, default: "failed" },
  },
  subdocumentOptions,
);

// One piece of background work, e.g. "draw the picture for panel 3 of story X".
const jobSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, ref: "Story", required: true },
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: WORK_STATUSES, required: true, default: "queued" },
    // Which panel or comic cell the job is for, when it is for one.
    panelNumber: { type: Number, min: 1, max: 15, default: null },
    cellNumber: { type: Number, min: 1, max: 40, default: null },
    // Each job records provider, model, duration and attempt count (guide BE-07).
    provider: { type: String, maxlength: 50, default: null },
    aiModel: { type: String, maxlength: 100, default: null }, // e.g. the FLUX model name ("model" is reserved by Mongoose)
    durationMs: { type: Number, min: 0, default: null },
    // Which version of our prompts made it (BE-10), and which fallback was used, if any
    // ("visual_brief", "universal_triumph", "title_formula"). Then status is "fallback".
    promptVersion: { type: String, maxlength: 20, default: null },
    fallbackUsed: { type: String, maxlength: 50, default: null },
    attempts: { type: Number, min: 0, required: true, default: 0 },
    // A short reason when status is "failed" (or why the last try failed, while retrying).
    error: { type: String, maxlength: 1000, default: null },
    // Which try is the current one. A try only saves its result if this still matches, so a
    // stuck old try (e.g. from a worker that crashed) can't overwrite the newer try's result.
    runId: { type: String, maxlength: 100, default: null },
    violations: { type: [violationSchema], default: [] },
  },
  baseSchemaOptions,
);

// Jobs by story (guide BE-02): Final Climb progress and Book Progress Detail.
jobSchema.index({ storyId: 1, createdAt: 1 });

export type JobFields = InferSchemaType<typeof jobSchema>;
export const Job = model("Job", jobSchema);
