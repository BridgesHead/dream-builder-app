import { directStory } from "../engine/director.js";
import type { StoryContext } from "../engine/context.js";
import type { PanelPlan } from "../engine/plan.js";
import type { DraftPanel } from "../engine/types.js";

// The words we send to the AI (guide BE-10). The STRUCTURE comes from the story director
// (BE-09); this file wraps it into the messages fal.ai gets.
//
// PROMPT_VERSION is saved on every job, so we always know which prompts made a story.
// Change it whenever the wording here changes (decision 5A: "v1" = our own prompts; the
// prototype's prompts, if Sami Bhai sends them, become "v2").
export const PROMPT_VERSION = "v1";

// ---- Hiding the hero's name (decision 6A, before BE-14) ----------------------------------
// The child may name the hero after themselves, so the AI never sees the hero's name: it
// sees a made-up stand-in, and we put the real name back in its answer.
export const STAND_IN = "Tibbo";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPattern = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "gu");

/** The hero's name → the stand-in (exact case, whole words only). */
export function hideName(text: string, heroName: string): string {
  return heroName && heroName !== STAND_IN ? text.replace(wordPattern(heroName), STAND_IN) : text;
}
/** The stand-in → the hero's name. */
export function revealName(text: string, heroName: string): string {
  return text.replace(wordPattern(STAND_IN), heroName);
}

/** The context the prompts are built from: the same story, with the hero's name hidden. */
function hidden(ctx: StoryContext): StoryContext {
  const hide = (s: string) => hideName(s, ctx.heroName);
  return {
    ...ctx,
    heroName: STAND_IN,
    heroWords: { 1: hide(ctx.heroWords[1]), 2: hide(ctx.heroWords[2]), 3: hide(ctx.heroWords[3]) },
    answers: { ...ctx.answers, charName: STAND_IN, safePlaceText: hide(ctx.answers.safePlaceText), oneMoreAmazingThing: hide(ctx.answers.oneMoreAmazingThing) },
  };
}

export interface Prompt {
  system: string;
  prompt: string;
}

const JSON_ONLY = "Answer with JSON only: no markdown, no explanation before or after it.";

function storySystem(ctx: StoryContext): string {
  const brief = directStory(hidden(ctx));
  return [
    "You write warm, gentle picture-book stories for children aged 8 to 14, in British English.",
    "Short sentences a child can read aloud. Concrete, sensory details. Kind and hopeful, never scary.",
    "Rules you must always follow:",
    ...brief.rules.map((r) => `- ${r}`),
    JSON_ONLY,
  ].join("\n");
}

const panelBrief = (p: ReturnType<typeof directStory>["panels"][number]) => ({
  number: p.number,
  title: p.label,
  act: p.act,
  write: p.instructions,
  ...(p.beats && { beats: p.beats.map((b, i) => `${i + 1}. ${b.name}: ${b.instructions}`) }),
});

/** The whole story, panel by panel. */
export function storyTextPrompt(ctx: StoryContext): Prompt {
  const brief = directStory(hidden(ctx));
  return {
    system: storySystem(ctx),
    prompt: [
      `Write the story as exactly ${brief.panels.length} panels, numbered 1 to ${brief.panels.length}.`,
      'Panels that list "beats" are written as an array of exactly 8 strings, one per beat, in order (no "text" field).',
      'Every other panel has a "text" field: 2 to 4 sentences.',
      `The JSON shape: ${brief.outputShape}`,
      "The panels:",
      JSON.stringify(brief.panels.map(panelBrief), null, 2),
    ].join("\n\n"),
  };
}

/** Only the panels the story engine sent back, with the reasons. */
export function rewritePrompt(ctx: StoryContext, requests: { panelNumber: number; reasons: string[] }[], current: DraftPanel[]): Prompt {
  const brief = directStory(hidden(ctx));
  const hide = (s: string) => hideName(s, ctx.heroName);
  const asked = requests.map((r) => {
    const now = current.find((p) => p.number === r.panelNumber);
    return {
      ...panelBrief(brief.panels.find((p) => p.number === r.panelNumber)!),
      currentVersion: now?.beats ? now.beats.map(hide) : hide(now?.text ?? ""),
      problems: r.reasons,
    };
  });
  return {
    system: storySystem(ctx),
    prompt: [
      `Rewrite ONLY these ${asked.length} panel(s) so the problems are fixed. Keep everything else about them.`,
      `Answer as { "panels": [ ... ] } with exactly these panel numbers: ${requests.map((r) => r.panelNumber).join(", ")}.`,
      'A panel with "beats" is answered as "beats" (8 strings); the others as "text".',
      JSON.stringify(asked, null, 2),
    ].join("\n\n"),
  };
}

/** "[HeroName] and the [Poetic Version of the Dream]" (PRD F12). */
export function titlePrompt(ctx: StoryContext): Prompt {
  return {
    system: "You name children's picture books. Answer with the title only, on one line.",
    prompt: [
      `The hero is called ${STAND_IN}. The child's dream: "${hideName(ctx.answers.aspiration, ctx.heroName)}".`,
      `Write the title in exactly this form: ${STAND_IN} and the [a short poetic name for the dream].`,
      `For example "${STAND_IN} and the Silver Stars" for a dream of becoming an astronaut.`,
      'Two to five words after "the", each starting with a capital letter. No quotes, no full stop.',
    ].join("\n"),
  };
}

/** Step 1 of the Scene Director chain: the AI describes the picture for one panel. */
export function scenePrompt(ctx: StoryContext, plan: PanelPlan, panelText: string): Prompt {
  const world = ctx.world ? `${ctx.world.name} (${ctx.world.words.slice(0, 4).join(", ")})` : "the child's dream world";
  return {
    system: "You are the Scene Director for a children's picture book. You describe what one illustration shows.",
    prompt: [
      `Panel ${plan.number}: ${plan.label}. The story is set in ${world}.`,
      `The panel's text: "${hideName(panelText, ctx.heroName)}"`,
      "Describe in ONE sentence of at most 40 words what the picture shows: the hero's action, the setting and the mood.",
      'Call the hero "the hero". Never use any names. Nothing written in the picture. Answer with the sentence only.',
    ].join("\n"),
  };
}

const TITLE_SHAPE = new RegExp(`^${STAND_IN} and the ((?:[A-Z][\\p{L}'’-]*)(?: [\\p{L}'’-]+){0,4})$`, "u");

/** The AI's title if it has the right shape, with the real name back in; else null. */
export function readTitle(raw: string, heroName: string): string | null {
  const line = raw.trim().split(/\r?\n/)[0].trim().replace(/^["'“‘]+|["'”’.]+$/g, "").trim();
  return TITLE_SHAPE.test(line) ? revealName(line, heroName) : null;
}

/** The AI's scene if it's usable; else null (the chain moves on to the Visual Brief table). */
export function readScene(raw: string): string | null {
  const scene = raw.trim().replace(/^["'“]+|["'”]+$/g, "").replace(/\s+/g, " ");
  if (scene.length < 10 || scene.length > 400) return null;
  return scene.replace(wordPattern(STAND_IN), "the hero");
}

/**
 * The Creator-mode sentence rewriter (BE-12): ONE other way to say the child's sentence, in
 * the same gentle tone. Our code checks the answer (src/engine/rewriteCheck.ts) and asks
 * again, with the reasons, when it breaks a rule.
 */
export function rewriteSentencePrompt(
  ctx: StoryContext,
  input: { sentence: string; panelText: string; maxWords: number; problems: string[] },
): Prompt {
  const hide = (s: string) => hideName(s, ctx.heroName);
  return {
    system: [
      "You help a child aged 12 to 14 polish one sentence of their own picture-book story, in British English.",
      "Keep their meaning, their hero and their ideas: only find a fresher, more vivid way to say it.",
      "Warm, gentle and hopeful. Never scary. No magic that fixes problems, and problems never simply disappear.",
      "Never use medical or clinical words (like anxiety, therapy or diagnosis).",
      "Answer with the new sentence only: one sentence, no quotes, no explanation.",
    ].join("\n"),
    prompt: [
      `The page it is on: "${hide(input.panelText)}"`,
      `The sentence to rewrite: "${hide(input.sentence)}"`,
      `Write exactly ONE sentence of at most ${input.maxWords} words.`,
      ...(input.problems.length ? [`Your last answer was refused because it ${input.problems.join(", and ")}. Fix that.`] : []),
    ].join("\n"),
  };
}
