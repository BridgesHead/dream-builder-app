import { config } from "../config.js";
import { buildContext } from "../engine/index.js";
import { fallbackTitle, imagePrompt, sceneFallback, seedFor, type Scene } from "../engine/visual.js";
import type { StoryContext } from "../engine/context.js";
import { logger } from "../lib/logger.js";
import type { AiProvider, AiResult } from "../jobs/providers.js";
import { askText, downloadImage, drawImage } from "./falClient.js";
import { PROMPT_VERSION, readScene, readTitle, rewritePrompt, scenePrompt, storyTextPrompt, titlePrompt } from "./prompts.js";
import { readStoryPanels } from "./storyJson.js";

// The REAL provider (guide BE-10): fal.ai writes the text and FLUX draws the pictures.
//
//   storyText     director prompt → any-llm → JSON (exactly 12 or 15 panels, else retry)
//   rewritePanels only the panels the engine sent back
//   title         "[HeroName] and the [Poetic Version of the Dream]"; formula if the AI's is off
//   panelImage    Scene Director chain → FLUX (fixed seed) → download, for OUR storage
//
// The hero's name never goes to fal.ai (decision 6A, see prompts.ts).

const result = <T>(value: T, aiModel: string, fallbackUsed: string | null = null): AiResult<T> => ({
  value,
  provider: "fal",
  aiModel,
  fallback: fallbackUsed !== null,
  fallbackUsed,
  promptVersion: PROMPT_VERSION,
});

/** Step 1: the AI's scene. Steps 2 and 3 (Visual Brief, Universal Triumph) if it can't help. */
async function sceneFor(ctx: StoryContext, panelNumber: number, panelText: string): Promise<Scene> {
  const plan = ctx.plan.find((p) => p.number === panelNumber);
  if (plan && panelText.trim()) {
    try {
      const scene = readScene(await askText(scenePrompt(ctx, plan, panelText)));
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
    const ctx = buildContext(story);
    const raw = await askText(storyTextPrompt(ctx));
    return result(readStoryPanels(raw, ctx.plan.map((p) => p.number), ctx.heroName), config.fal.textModel);
  },

  async rewritePanels(story, requests, current) {
    const ctx = buildContext(story);
    const raw = await askText(rewritePrompt(ctx, requests, current));
    return result(readStoryPanels(raw, requests.map((r) => r.panelNumber), ctx.heroName), config.fal.textModel);
  },

  async title(story) {
    const ctx = buildContext(story);
    const title = readTitle(await askText(titlePrompt(ctx)), ctx.heroName);
    return title ? result(title, config.fal.textModel) : result(fallbackTitle(ctx), config.fal.textModel, "title_formula");
  },

  async panelImage(story, panelNumber, panelText) {
    const ctx = buildContext(story);
    // A two-act story has no panels 13–15: never draw one.
    if (!ctx.plan.some((p) => p.number === panelNumber)) {
      throw new Error(`Panel ${panelNumber} isn't in this story's plan`);
    }
    const scene = await sceneFor(ctx, panelNumber, panelText);
    const url = await drawImage({ prompt: imagePrompt(ctx, scene.text), seed: seedFor(ctx) });
    const picture = await downloadImage(url);
    return result(picture, config.fal.imageModel, scene.source === "director" ? null : scene.source);
  },
};
