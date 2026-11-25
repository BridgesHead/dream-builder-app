import type { Mode, StoryPath } from "../types/story.js";
import { planFor, type PanelPlan } from "./plan.js";
import {
  BODY_SIGNALS,
  DREAM_WORLDS,
  FALLBACK_CORE_NOUN,
  HERO_DEFAULT_NAMES,
  TOOL_WORDS,
  type DreamWorld,
  type HeroType,
} from "./tables.js";
import { capitalise, unquote } from "./text.js";

// Everything the engine needs to know about ONE story, worked out once from the child's
// answers: the hero's name, pronoun forms, body signal, tools, Core Noun, dream world and
// the child's own words.

/** The child's answers, as saved on the story (the fields the engine uses). */
export interface StoryAnswers {
  storyPath: StoryPath;
  mode: Mode;
  heroType: string | null;
  /** The look the child picked ("soft-peaceful", "clear-bold", "indie-graphic-novel"), or null. */
  comicVibe?: string | null;
  charName: string;
  heroPronoun: string | null;
  charTools: string[];
  charStrengths: string[];
  selfLove: string;
  oneMoreAmazingThing: string;
  aspiration: string;
  obstacles: string[];
  obstacles2: string[];
  obstacles3: string[];
  heartColor: string;
  heartColor2: string;
  heartColor3: string;
  braveMove: string;
  braveMove2: string;
  braveMove3: string;
  heroWords: string;
  heroWords2: string;
  heroWords3: string;
  safePlaceText: string;
  thirdChallengeText: string;
}

export interface Pronouns {
  subject: string; // she / he
  object: string; // her / him
  possessive: string; // her / his
}

export interface StoryContext {
  answers: StoryAnswers;
  plan: PanelPlan[];
  heroType: HeroType;
  /** charName → the hero type's default name → "Sparky" (PRD F1). */
  heroName: string;
  /** The other heroes' default names, for the bleed-guard (defect 3). */
  otherHeroNames: string[];
  otherHeroTypes: HeroType[];
  pronoun: Pronouns;
  /** The tools the child chose, as words ("white cane"). */
  toolWords: string[];
  /** For "took her next brave step toward becoming the [Core Noun]" (PRD §6 rule 10). */
  coreNoun: string;
  /** The dream-world row that matches the dream, or null (then rule 2 isn't checked). */
  world: DreamWorld | null;
  /** The child's own brave words for acts 1–3, without quotes ("" when not given). */
  heroWords: { 1: string; 2: string; 3: string };
  /** Every piece of the child's own writing, never changed by the engine. */
  childWords: string[];
}

const PRONOUNS: Record<"he" | "she", Pronouns> = {
  she: { subject: "she", object: "her", possessive: "her" },
  he: { subject: "he", object: "him", possessive: "his" },
};

const HERO_TYPES: HeroType[] = ["fox", "robot", "knight"];

/**
 * The Core Noun from the dream (decision 4A, waiting for Sami Bhai to confirm):
 *   "be a vet" / "to become an astronaut" → "vet" / "astronaut"
 *   an action ("fly to the moon")         → the dream world's noun ("astronaut")
 *   nothing matches                        → "dreamer"
 */
export function coreNounFor(aspiration: string, world: DreamWorld | null): string {
  const dream = aspiration.trim().replace(/[.!?]+$/, "");
  const role = /^(?:i want to\s+|to\s+)?(?:be|become|becoming)\s+(?:(?:a|an|the)\s+)?(.+)$/i.exec(dream);
  if (role) {
    const noun = role[1].trim().split(/\s+/).slice(0, 5).join(" ").toLowerCase();
    if (noun) return noun;
  }
  return world?.noun ?? FALLBACK_CORE_NOUN;
}

export function dreamWorldFor(aspiration: string): DreamWorld | null {
  return DREAM_WORLDS.find((w) => w.match.test(aspiration)) ?? null;
}

export function buildContext(answers: StoryAnswers): StoryContext {
  const heroType = (HERO_TYPES.includes(answers.heroType as HeroType) ? answers.heroType : "robot") as HeroType;
  if (answers.heroPronoun !== "he" && answers.heroPronoun !== "she") {
    // The draft check (BE-08) makes sure a pronoun is chosen before generation.
    throw new Error("The story has no hero pronoun");
  }
  const heroName = capitalise(answers.charName.trim()) || HERO_DEFAULT_NAMES[heroType] || "Sparky";
  const world = dreamWorldFor(answers.aspiration);
  const heroWords = { 1: unquote(answers.heroWords), 2: unquote(answers.heroWords2), 3: unquote(answers.heroWords3) };
  const otherHeroTypes = HERO_TYPES.filter((t) => t !== heroType);

  return {
    answers,
    plan: planFor(answers.storyPath),
    heroType,
    heroName,
    // "Brave" (the knight's default name) is also an everyday word, so it can't be searched for.
    otherHeroNames: otherHeroTypes.map((t) => HERO_DEFAULT_NAMES[t]).filter((n) => n !== "Brave" && n !== heroName),
    otherHeroTypes,
    pronoun: PRONOUNS[answers.heroPronoun],
    toolWords: answers.charTools.map((t) => TOOL_WORDS[t]).filter((t): t is string => !!t),
    coreNoun: coreNounFor(answers.aspiration, world),
    world,
    heroWords,
    childWords: [heroWords[1], heroWords[2], heroWords[3], unquote(answers.thirdChallengeText)].filter((w) => w.length > 0),
  };
}

/** The phrase every Grand Finale must contain (PRD §6 rule 10). */
export function braveStepPhrase(ctx: StoryContext): string {
  return `took ${ctx.pronoun.possessive} next brave step toward becoming the ${ctx.coreNoun}`;
}

export const PRACTICE_TAG = "One real step today.";

export { BODY_SIGNALS };
