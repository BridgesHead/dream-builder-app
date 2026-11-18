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

// ---- The wizard's answer options (guide BE-08) --------------------------------------
// Copied from the frontend's src/data/content.ts. The ids must match exactly: if a list
// there changes, change it here too. The server only accepts these ids, so a direct API
// caller can't save an answer the wizard could never show.

export const ACTS = [1, 2, 3] as const;
export type Act = (typeof ACTS)[number];

// "What makes your hero special": a different list per mode.
export const STRENGTHS: Record<Mode, readonly string[]> = {
  junior: ["big-curiosity", "kind-heart", "clever-inventions", "super-focus", "creative-vision", "brave-courage"],
  senior: ["curious", "empathetic", "inventive", "focused", "imaginative", "resilient"],
};

export const TOOLS = ["wheelchair", "headphones", "fidget-toy", "white-cane", "hearing-aid", "glasses"] as const;

// Act 3 reuses the Act 1 obstacles, as in the frontend.
const OBSTACLES_FIRST = ["grumpy-giant", "roaring-fire", "humming-mist", "messy-blueprint"] as const;
export const OBSTACLES: Record<Act, readonly string[]> = {
  1: OBSTACLES_FIRST,
  2: ["mean-whispers", "thundering-cloud", "glass-wall", "mean-shadow"],
  3: OBSTACLES_FIRST,
};

const FEELINGS_ALL = ["foggy", "heavy", "jumpy", "thumpy", "fluttery", "steady"] as const;
// Creator mode, final act: a wider set of feelings.
const FEELINGS_CREATOR_FINAL = ["clouded", "weighed-down", "on-edge", "burning", "exposed", "shut-out", "stuck", "steady"] as const;
export function feelingsFor(mode: Mode, act: Act): readonly string[] {
  return mode === "senior" && act === 3 ? FEELINGS_CREATOR_FINAL : FEELINGS_ALL;
}

// Act 3 reuses the Act 1 brave moves, as in the frontend.
const MOVES_GROUNDING = ["shrink-the-giant", "find-first-step", "ask-for-help", "deep-breaths"] as const;
export const BRAVE_MOVES: Record<Act, readonly string[]> = {
  1: MOVES_GROUNDING,
  2: ["lead-the-way", "try-something-new", "stand-my-ground", "calm-honesty"],
  3: MOVES_GROUNDING,
};

// The StoryState field names for each act.
export const ACT_FIELDS = {
  1: { obstacles: "obstacles", feeling: "heartColor", move: "braveMove", words: "heroWords" },
  2: { obstacles: "obstacles2", feeling: "heartColor2", move: "braveMove2", words: "heroWords2" },
  3: { obstacles: "obstacles3", feeling: "heartColor3", move: "braveMove3", words: "heroWords3" },
} as const;

// Cleared when the child picks two acts at the Challenge Gate (guide BE-08).
export const THIRD_ACT_FIELDS = ["obstacles3", "heartColor3", "braveMove3", "heroWords3", "thirdChallengeText"] as const;

// ---- What the client may send in PATCH /stories/:id (guide BE-08) ---------------------
// - Only the fields that changed (all optional), at least one.
// - The server controls childId (fixed at creation), confirmedByChild ("I'm done!", BE-12),
//   storyGeneratedAt (generation, BE-10), status, mode and storyPath (set from the
//   Challenge Gate answer). Sending any of them, or any unknown field, is a 400.
// - Here each answer must be a REAL option id from some mode. Whether it is allowed for
//   THIS story's mode is checked afterwards in services/storyRules.ts, because the mode
//   lives on the story, not in the request.

const unique = (values: string[]) => new Set(values).size === values.length;
// A pick list: real ids only, no repeats, at most `max`.
const picks = (ids: readonly string[], max: number) =>
  z.array(z.enum(ids as [string, ...string[]])).max(max).refine(unique, "Each choice can be picked only once");
// A single pick, or "" for "not chosen yet" (the frontend's empty value).
const pick = (ids: readonly string[]) => z.union([z.literal(""), z.enum(ids as [string, ...string[]])]);

const ALL_STRENGTHS = [...STRENGTHS.junior, ...STRENGTHS.senior];
const ALL_FEELINGS = [...new Set([...FEELINGS_ALL, ...FEELINGS_CREATOR_FINAL])];
const words = z.string().max(500);

export const StoryPatchSchema = z
  .object({
    authorName: shortText,
    selectedFormat: z.enum(FORMATS).nullable(),
    comicVibe: z.enum(ART_STYLES).nullable(),
    heroType: z.enum(HERO_TYPES).nullable(),
    charName: shortText,
    // Only "he" or "she". "they" is a 400 (guide BE-08).
    heroPronoun: z.enum(PRONOUNS).nullable(),
    charStrengths: picks(ALL_STRENGTHS, 3),
    selfLove: text,
    charTools: picks(TOOLS, TOOLS.length),
    aspiration: text,
    obstacles: picks(OBSTACLES[1], 4),
    heartColor: pick(ALL_FEELINGS),
    braveMove: pick(BRAVE_MOVES[1]),
    heroWords: words,
    safePlaceText: text,
    obstacles2: picks(OBSTACLES[2], 4),
    heartColor2: pick(ALL_FEELINGS),
    braveMove2: pick(BRAVE_MOVES[2]),
    heroWords2: words,
    facesChallenge3: z.boolean().nullable(),
    obstacles3: picks(OBSTACLES[3], 4),
    heartColor3: pick(ALL_FEELINGS),
    braveMove3: pick(BRAVE_MOVES[3]),
    heroWords3: words,
    // Fields the guide adds to StoryState.
    oneMoreAmazingThing: z.string().max(500),
    thirdChallengeText: text,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field to save" });

export type StoryPatch = z.infer<typeof StoryPatchSchema>;
