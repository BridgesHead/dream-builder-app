import { z } from "zod";

// Mirrors `StoryState` in the frontend's src/state/AppState.tsx (and the unions in
// src/data/content.ts). Field names and types must stay identical: if the frontend
// changes StoryState, change this file too.
//
// The lists below are shared by the Zod schemas (checking API requests) and the
// Mongoose schemas (checking what we save), so both always agree.

// From content.ts
export const HERO_TYPES = ["fox", "robot", "knight"] as const;
export const PRONOUNS = ["he", "she"] as const; // "they" is not allowed (guide BE-02, BE-08)
export const ART_STYLES = ["soft-peaceful", "clear-bold", "indie-graphic-novel"] as const;
export const FORMATS = ["storybook", "comic"] as const;

// Explorer (junior, under 12) or Creator (senior, 12 and over).
export const MODES = ["junior", "senior"] as const;
export type Mode = (typeof MODES)[number];

// Chosen at the Challenge Gate: two acts = 12 panels, three acts = 15 panels.
export const STORY_PATHS = ["two_act", "three_act"] as const;
export type StoryPath = (typeof STORY_PATHS)[number];
export const PANEL_COUNT: Record<StoryPath, number> = { two_act: 12, three_act: 15 };

// The story lifecycle (guide BE-02):
//   draft -> generating -> child_review -> parent_review -> approved
//   and parent_review can send it back to child_review.
// The allowed changes live in src/services/storyLifecycle.ts.
export const STORY_STATUSES = ["draft", "generating", "child_review", "parent_review", "approved"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

// Status of one panel's text or picture, and of one job (guide BE-07).
export const WORK_STATUSES = ["queued", "running", "success", "fallback", "failed"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

// A MongoDB id as text: 24 hex characters, e.g. "665f1c2ab0d4e1a2b3c4d5e6".
export const objectIdString = z.string().regex(/^[0-9a-f]{24}$/i, "Invalid id");

// Length limits keep one request from stuffing megabytes into the database.
// They're generous so no real answer from a child gets rejected.
const shortText = z.string().max(100); // names
const text = z.string().max(2000); // free-text answers
const list = z.array(z.string().max(500)).max(20); // multi-pick answers

export const StoryStateSchema = z.object({
  authorName: shortText,
  selectedFormat: z.enum(FORMATS).nullable(),
  comicVibe: z.enum(ART_STYLES).nullable(),
  heroType: z.enum(HERO_TYPES).nullable(),
  charName: shortText,
  heroPronoun: z.enum(PRONOUNS).nullable(), // null until the child picks one
  charStrengths: list,
  selfLove: text,
  charTools: list,
  aspiration: text,
  obstacles: list,
  heartColor: text,
  braveMove: text,
  heroWords: text,
  safePlaceText: text,
  obstacles2: list,
  heartColor2: text,
  braveMove2: text,
  heroWords2: text,
  facesChallenge3: z.boolean().nullable(), // null = not decided, false = skipped the Challenge Gate
  obstacles3: list,
  heartColor3: text,
  braveMove3: text,
  heroWords3: text,
  storyGeneratedAt: z.iso.datetime().nullable(),
  confirmedByChild: z.boolean(),
  childId: objectIdString.nullable(),
});

export type StoryState = z.infer<typeof StoryStateSchema>;

// Same values as EMPTY_STORY in the frontend.
export const EMPTY_STORY: StoryState = {
  authorName: "",
  selectedFormat: null,
  comicVibe: null,
  heroType: null,
  charName: "",
  heroPronoun: null,
  charStrengths: [],
  selfLove: "",
  charTools: [],
  aspiration: "",
  obstacles: [],
  heartColor: "",
  braveMove: "",
  heroWords: "",
  safePlaceText: "",
  obstacles2: [],
  heartColor2: "",
  braveMove2: "",
  heroWords2: "",
  facesChallenge3: null,
  obstacles3: [],
  heartColor3: "",
  braveMove3: "",
  heroWords3: "",
  storyGeneratedAt: null,
  confirmedByChild: false,
  childId: null,
};

// What the client may send in PATCH /stories/:id. BE-08 reworks this with the mode rules.
// - omit: the server controls these three. childId is fixed at creation,
//   confirmedByChild is set by "I'm done!", storyGeneratedAt by story generation.
// - partial: send only the fields that changed.
// - strict: an unknown field (a typo, or one of the omitted ones) is a 400,
//   not silently dropped, so mistakes show up right away.
export const StoryPatchSchema = StoryStateSchema.omit({
  childId: true,
  confirmedByChild: true,
  storyGeneratedAt: true,
})
  .partial()
  .strict();

export type StoryPatch = z.infer<typeof StoryPatchSchema>;
