import { config } from "../config.js";
import { buildContext } from "../engine/index.js";
import { fallbackTitle, imagePrompt, sceneFallback, seedFor, type Scene } from "../engine/visual.js";
import { logger } from "../lib/logger.js";
import type { AiProvider, AiResult, StoryForAi } from "../jobs/providers.js";
import { NO_FAMILY } from "./anonymise.js";
import { askText, createGate, downloadImage, drawImage, type FalGate } from "./falClient.js";
import {
  aiNameFor,
  PROMPT_VERSION,
  readScene,
  readTitle,
  revealName,
  rewritePrompt,
  rewriteSentencePrompt,
  scenePrompt,
  storyTextPrompt,
  titlePrompt,
  type PromptContext,
} from "./prompts.js";
import { readStoryPanels } from "./storyJson.js";

// The REAL provider (guide BE-10): fal.ai writes the text and FLUX draws the pictures.
//
//   storyText     director prompt → any-llm → JSON (exactly 12 or 15 panels, else retry)
//   rewritePanels only the panels the engine sent back
//   title         "[HeroName] and the [Poetic Version of the Dream]"; formula if the AI's is off
//   panelImage    Scene Director chain → FLUX (fixed seed) → download, for OUR storage
//                 (a redraw, BE-12, moves the seed on by its variant number for a new picture)
//   rewriteSentence  one other way to say a sentence (Creator mode, BE-12)
//
// Every call goes through the anonymising gate (BE-14, falClient.ts). The AI sees the hero's
// real name unless it's a family name; then a stand-in (prompts.ts, aiNameFor).

/** The story context for prompts, the gate for this call, and the name the AI sees. */
function prepare(story: StoryForAi): { ctx: PromptContext; gate: FalGate } {
  const family = story.family ?? NO_FAMILY;
  const base = buildContext(story);
  const aiName = aiNameFor(base.heroName, family);
  return { ctx: { ...base, aiName }, gate: createGate(family, aiName) };
}

const result = <T>(gate: FalGate, value: T, aiModel: string, fallbackUsed: string | null = null): AiResult<T> => ({
  value,
  provider: "fal",
  aiModel,
  fallback: fallbackUsed !== null,
  fallbackUsed,
  promptVersion: PROMPT_VERSION,
  // The anonymised requests only, for the job record (BE-14).
  aiRequests: gate.sent,
});

/** Step 1: the AI's scene. Steps 2 and 3 (Visual Brief, Universal Triumph) if it can't help. */
async function sceneFor(ctx: PromptContext, gate: FalGate, panelNumber: number, panelText: string): Promise<Scene> {
  const plan = ctx.plan.find((p) => p.number === panelNumber);
  if (plan && panelText.trim()) {
    try {
      const scene = readScene(await askText(gate, scenePrompt(ctx, plan, panelText)), ctx.aiName);
      if (scene) return { text: scene, source: "director" };
    } catch (err) {
      // Not a failure of the job: the chain moves on, and the fallback is recorded.
      logger.warn({ panelNumber, reason: err instanceof Error ? err.message : String(err) }, "Scene Director failed; using the fallback");
    }
  }
  return sceneFallback(plan?.role, ctx);
}

export const falProvider: AiProvider = {
  async storyText(story) {
    const { ctx, gate } = prepare(story);
    const raw = await askText(gate, storyTextPrompt(ctx));
    return result(gate, readStoryPanels(raw, ctx.plan.map((p) => p.number), ctx.heroName, ctx.aiName), config.fal.textModel);
  },

  async rewritePanels(story, requests, current) {
    const { ctx, gate } = prepare(story);
    const raw = await askText(gate, rewritePrompt(ctx, requests, current));
    return result(gate, readStoryPanels(raw, requests.map((r) => r.panelNumber), ctx.heroName, ctx.aiName), config.fal.textModel);
  },

  async title(story) {
    const { ctx, gate } = prepare(story);
    const title = readTitle(await askText(gate, titlePrompt(ctx)), ctx.heroName, ctx.aiName);
    return title ? result(gate, title, config.fal.textModel) : result(gate, fallbackTitle(ctx), config.fal.textModel, "title_formula");
  },

  async panelImage(story, panelNumber, panelText, variant = 0) {
    const { ctx, gate } = prepare(story);
    // A two-act story has no panels 13–15: never draw one.
    if (!ctx.plan.some((p) => p.number === panelNumber)) {
      throw new Error(`Panel ${panelNumber} isn't in this story's plan`);
    }
    const scene = await sceneFor(ctx, gate, panelNumber, panelText);
    // The story's own seed keeps the hero looking the same; a redraw nudges it for a new picture.
    const seed = (seedFor(ctx) + variant) % 2_147_483_647;
    const url = await drawImage(gate, { prompt: imagePrompt(ctx, scene.text), seed });
    const picture = await downloadImage(url);
    return result(gate, picture, config.fal.imageModel, scene.source === "director" ? null : scene.source);
  },

  async rewriteSentence(story, input) {
    const { ctx, gate } = prepare(story);
    const raw = await askText(gate, rewriteSentencePrompt(ctx, input));
    // The hero's real name goes back in (if the AI only saw the stand-in).
    return result(gate, revealName(raw, ctx.heroName, ctx.aiName), config.fal.textModel);
  },
};
