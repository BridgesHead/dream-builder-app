import { model, Schema, type InferSchemaType } from "mongoose";
import {
  ART_STYLES,
  FORMATS,
  HERO_TYPES,
  MODES,
  PRONOUNS,
  STORY_PATHS,
  STORY_STATUSES,
  WORK_STATUSES,
} from "../../types/story.js";
import { baseSchemaOptions, subdocumentOptions } from "../schemaOptions.js";

// ---- Small reusable field shapes -------------------------------------------------

// Answers that are "not chosen yet" until the child picks: null is allowed, anything
// outside the list is refused.
const choice = (values: readonly string[]) => ({ type: String, enum: [...values, null], default: null });
const answer = (maxlength = 2000) => ({ type: String, trim: true, maxlength, default: "" });
const answerList = {
  type: [{ type: String, maxlength: 500 }],
  default: [],
  validate: { validator: (v: string[]) => v.length <= 20, message: "at most 20 items" },
};

// Where a picture lives in OUR bucket, e.g. "stories/665f.../panel-03.webp".
// Never a web link: images must be copied into our bucket, never point at fal.ai.
const imageKey = {
  type: String,
  default: null,
  validate: {
    validator: (v: string | null) => v === null || !/^https?:\/\//i.test(v),
    message: "imageKey must be a key in our bucket, not a web link",
  },
};
const workStatus = { type: String, enum: WORK_STATUSES, required: true, default: "queued" };

// ---- Panels and comic cells, stored INSIDE the story ------------------------------

// One page of the storybook. 12 panels for two_act, 15 for three_act.
const panelSchema = new Schema(
  {
    number: { type: Number, required: true, min: 1, max: 15 },
    text: answer(4000),
    // Earlier versions of the text, oldest first. An inline edit (BE-12) keeps the old one here.
    previousTexts: { type: [String], default: [] },
    imageKey,
    textStatus: workStatus,
    imageStatus: workStatus,
    // A redraw (BE-12): null = never asked. While "queued"/"running" the old picture is still
    // shown; only a successful redraw changes imageKey. "failed" = the old picture stayed.
    redrawStatus: { type: String, enum: [...WORK_STATUSES, null], default: null },
    // Earlier pictures, oldest first (kept in our bucket, so nothing is lost by a redraw).
    previousImageKeys: { type: [String], default: [] },
  },
  subdocumentOptions,
);

// An earlier version of a comic cell's words (BE-12 inline edits keep the old one).
const cellVersionSchema = new Schema(
  {
    caption: { type: String, maxlength: 1000, default: "" },
    dialogue: { type: String, maxlength: 500, default: null },
  },
  subdocumentOptions,
);

// One cell of the comic (BE-11): 8 pages x 4 cells for two acts, 10 x 4 for three acts.
const comicCellSchema = new Schema(
  {
    page: { type: Number, required: true, min: 1, max: 10 },
    cell: { type: Number, required: true, min: 1, max: 4 },
    caption: answer(1000),
    dialogue: { type: String, trim: true, maxlength: 500, default: null },
    bubbleType: { type: String, enum: ["thought", "speech", "none"], required: true, default: "none" },
    // A Tempo bubble holds music notation only (BE-11 checks that rule).
    tempo: { type: String, maxlength: 100, default: null },
    // Earlier caption + dialogue, oldest first (BE-12).
    previousVersions: { type: [cellVersionSchema], default: [] },
    imageKey,
    imageStatus: workStatus,
  },
  subdocumentOptions,
);

// ---- The story ------------------------------------------------------------------

// One document per story, with its panels and comic cells inside (guide BE-02).
// Holds every StoryState field from the frontend, with the same names.
const storySchema = new Schema(
  {
    // The owning child. The parent is found through the child (child.parentId).
    childId: { type: Schema.Types.ObjectId, ref: "Child", required: true },
    status: { type: String, enum: STORY_STATUSES, required: true, default: "draft" },
    // The child's mode when the story was started. The mode rules (BE-08) and the
    // picture style (BE-10) follow it, even if the parent changes the child's mode later.
    mode: { type: String, enum: MODES, required: true },
    // null until the child passes the Challenge Gate.
    storyPath: choice(STORY_PATHS),
    // "[HeroName] and the [Poetic Version of the Dream]", made by the title job (BE-10).
    title: answer(200),

    // StoryState (frontend AppState.tsx), same names and meaning.
    authorName: answer(100),
    selectedFormat: choice(FORMATS),
    comicVibe: choice(ART_STYLES),
    heroType: choice(HERO_TYPES),
    charName: answer(100),
    // Only "he" or "she" (or null = not picked yet). "they" is refused.
    heroPronoun: choice(PRONOUNS),
    charStrengths: answerList,
    selfLove: answer(),
    charTools: answerList,
    aspiration: answer(),
    obstacles: answerList,
    heartColor: answer(),
    braveMove: answer(),
    heroWords: answer(),
    safePlaceText: answer(),
    obstacles2: answerList,
    heartColor2: answer(),
    braveMove2: answer(),
    heroWords2: answer(),
    // null = not decided yet, false = the child skipped the Challenge Gate.
    facesChallenge3: { type: Boolean, default: null },
    obstacles3: answerList,
    heartColor3: answer(),
    braveMove3: answer(),
    heroWords3: answer(),
    storyGeneratedAt: { type: Date, default: null },
    // true once the child taps "I'm done!" (BE-12); false again after a change request.
    confirmedByChild: { type: Boolean, required: true, default: false },
    // When the parent approved it (BE-12). Only an approved story can be bought (BE-17).
    approvedAt: { type: Date, default: null },

    // Fields the guide adds to StoryState.
    oneMoreAmazingThing: answer(),
    thirdChallengeText: answer(),

    panels: {
      type: [panelSchema],
      default: [],
      validate: [
        { validator: (v: { number: number }[]) => v.length <= 15, message: "a story has at most 15 panels" },
        {
          validator: (v: { number: number }[]) => new Set(v.map((p) => p.number)).size === v.length,
          message: "each panel number can appear only once",
        },
      ],
    },
    comicCells: {
      type: [comicCellSchema],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= 40, message: "a comic has at most 40 cells" },
    },
  },
  baseSchemaOptions,
);

// Indexes for the queries the screens make (guide BE-02):
// a child's library, newest first...
storySchema.index({ childId: 1, updatedAt: -1 });
// ...and stories by status (e.g. everything waiting for parent review).
storySchema.index({ status: 1 });

export type StoryFields = InferSchemaType<typeof storySchema>;
export const Story = model("Story", storySchema);
