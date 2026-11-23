import { AppError, type FieldErrors } from "../lib/errors.js";
import {
  ACT_FIELDS,
  ACTS,
  feelingsFor,
  STRENGTHS,
  THIRD_ACT_FIELDS,
  type Act,
  type Mode,
  type StoryPatch,
  type StoryPath,
} from "../types/story.js";

// The story draft rules (guide BE-08). Plain functions: no database, no HTTP, so each rule
// is easy to test on its own (tests/unit/storyRules.test.ts).

// The answers of a saved draft, as far as these rules need them. "Not chosen yet" may be
// null or missing (Mongoose types optional fields that way).
export interface DraftAnswers {
  authorName: string;
  selectedFormat?: string | null;
  comicVibe?: string | null;
  heroType?: string | null;
  heroPronoun?: string | null;
  charStrengths: string[];
  aspiration: string;
  obstacles: string[];
  heartColor: string;
  braveMove: string;
  heroWords: string;
  safePlaceText: string;
  obstacles2: string[];
  heartColor2: string;
  braveMove2: string;
  heroWords2: string;
  facesChallenge3?: boolean | null;
  obstacles3: string[];
  heartColor3: string;
  braveMove3: string;
  heroWords3: string;
}

const filled = (value: string | null | undefined) => !!value && value.trim().length > 0;

// ---- 1. Mode rules: Creator-only answers are refused on an Explorer draft -------------
// (and the other way round). Decision 4A: "Creator-only" = the options content.ts shows only
// in Creator mode: the Creator strengths and the Creator final-act feelings. Waiting for
// Sami Bhai to confirm the PRD's exact list.
export function modeProblems(mode: Mode, patch: StoryPatch): FieldErrors {
  const problems: FieldErrors = {};
  const label = mode === "junior" ? "an Explorer" : "a Creator";

  const wrongStrengths = (patch.charStrengths ?? []).filter((s) => !STRENGTHS[mode].includes(s));
  if (wrongStrengths.length > 0) {
    problems.charStrengths = [`Not ${label} strength: ${wrongStrengths.join(", ")}`];
  }
  for (const act of ACTS) {
    const field = ACT_FIELDS[act].feeling;
    const feeling = patch[field];
    if (feeling && !feelingsFor(mode, act).includes(feeling)) {
      problems[field] = [`Not ${label} feeling for act ${act}: ${feeling}`];
    }
  }
  return problems;
}

// ---- 2. oneMoreAmazingThing is cleaned the same way for every caller (defect 8) -------
// Decision 5A: trim, single spaces, no trailing full stops. Waiting for Sami Bhai to confirm
// the PRD's exact rule; change it here and only here.
export function normaliseOneMoreAmazingThing(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
}

// ---- 3. The Challenge Gate decides the story path ---------------------------------------
export function pathFor(facesChallenge3: boolean | null): StoryPath | null {
  if (facesChallenge3 === null) return null;
  return facesChallenge3 ? "three_act" : "two_act";
}

const EMPTY_THIRD_ACT = { obstacles3: [], heartColor3: "", braveMove3: "", heroWords3: "", thirdChallengeText: "" };

// Turns one wizard save into the changes to store. Throws 400 VALIDATION_FAILED if the save
// breaks a rule. `current` is the draft as saved before this request.
export function changesForSave(mode: Mode, current: { facesChallenge3?: boolean | null }, patch: StoryPatch) {
  const problems = modeProblems(mode, patch);

  // The gate answer after this save: the new one if sent, otherwise the saved one.
  const gate = patch.facesChallenge3 !== undefined ? patch.facesChallenge3 : (current.facesChallenge3 ?? null);
  if (gate === false) {
    // A two-act story never gains Act 3 answers. Empty values are fine (the frontend's
    // "nothing chosen"), real answers are refused.
    for (const field of THIRD_ACT_FIELDS) {
      const value = patch[field];
      if (Array.isArray(value) ? value.length > 0 : filled(value)) {
        problems[field] = ["This story has two acts, so the third act can't be filled in"];
      }
    }
  }
  if (Object.keys(problems).length > 0) {
    throw new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", problems);
  }

  const changes: Record<string, unknown> = { ...patch };
  if (patch.oneMoreAmazingThing !== undefined) {
    changes.oneMoreAmazingThing = normaliseOneMoreAmazingThing(patch.oneMoreAmazingThing);
  }
  // Switching to two acts clears everything from the third act.
  if (gate === false) Object.assign(changes, EMPTY_THIRD_ACT);
  // storyPath always follows the gate answer, so the two can never disagree.
  if (patch.facesChallenge3 !== undefined) changes.storyPath = pathFor(gate);
  return changes;
}

// ---- 4. Is the draft complete? (defect 2) ------------------------------------------------
// The same steps, names and order as the frontend wizard (src/lib/flow.ts and the keys of
// ROUTES in src/lib/routes.ts), so the frontend can send the child straight to the first
// missing step. Explorer answers each act on three screens, Creator on one.
function actSteps(mode: Mode, act: Act, story: DraftAnswers): { step: string; done: boolean }[] {
  const f = ACT_FIELDS[act];
  const obstacle = story[f.obstacles].length > 0;
  const feeling = filled(story[f.feeling]);
  const move = filled(story[f.move]) && filled(story[f.words]);
  if (mode === "senior") return [{ step: `act${act}`, done: obstacle && feeling && move }];
  return [
    { step: `act${act}.obstacle`, done: obstacle },
    { step: `act${act}.feeling`, done: feeling },
    { step: `act${act}.move`, done: move },
  ];
}

export function missingSteps(mode: Mode, story: DraftAnswers): string[] {
  const explorer = mode === "junior";
  const steps = [
    { step: "author", done: filled(story.authorName) },
    { step: "format", done: !!story.selectedFormat },
    { step: "style", done: !!story.comicVibe },
    // Explorer picks the hero, then name and pronoun on the next screen; Creator does both at once.
    { step: "hero", done: !!story.heroType && (explorer || !!story.heroPronoun) },
    ...(explorer ? [{ step: "heroName", done: !!story.heroType && !!story.heroPronoun }] : []),
    // Tools and the hero's own name are optional, as in the frontend.
    { step: "strength", done: story.charStrengths.length > 0 },
    { step: "dream", done: filled(story.aspiration) },
    ...actSteps(mode, 1, story),
    { step: "rest", done: filled(story.safePlaceText) },
    ...actSteps(mode, 2, story),
    { step: "gate", done: story.facesChallenge3 === true || story.facesChallenge3 === false },
    ...(story.facesChallenge3 ? actSteps(mode, 3, story) : []),
  ];
  return steps.filter((s) => !s.done).map((s) => s.step);
}
