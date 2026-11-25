import { buildContext } from "../engine/index.js";
import { comicCellPrompt, fallbackTitle, imagePrompt, sceneFallback, seedFor, type Scene } from "../engine/visual.js";
import { readComicCells } from "./comicJson.js";
import type { AiProvider, AiResult, StoryForAi } from "../jobs/providers.js";
import { logger } from "../lib/logger.js";
import { NO_FAMILY } from "./anonymise.js";
import { cloudflareImage, cloudflareText } from "./cloudflareClient.js";
import { falImage, falText } from "./falClient.js";
import { createGate, type AiGate, type ImageClient, type TextClient } from "./gate.js";
import { geminiImage, geminiText } from "./geminiClient.js";
import {
  aiNameFor,
  comicPagePrompt,
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
import { stubProvider } from "./stubProvider.js";

// The REAL provider (guide BE-10), built from one service for the TEXT and one for the PICTURES:
//
//   text      fal.ai (any-llm) | Gemini | Cloudflare (Llama)   or the stub
//   pictures  fal.ai (FLUX)    | Gemini | Cloudflare (FLUX schnell)   or the stub
//
//   storyText     director prompt → text AI → JSON (exactly 12 or 15 panels, else retry)
//   rewritePanels only the panels the engine sent back
//   title         "[HeroName] and the [Poetic Version of the Dream]"; formula if the AI's is off
//   panelImage    Scene Director (the TEXT AI) → picture AI (fixed seed where it takes one) →
//                 a picture for OUR storage. A redraw (BE-12) moves the seed on by its variant.
//   rewriteSentence  one other way to say a sentence (Creator mode, BE-12)
//
// The story logic lives here once, whichever services run it. Every call goes through the
// anonymising gate (BE-14, gate.ts). The AI sees the hero's real name unless it's a family
// name; then a stand-in (prompts.ts, aiNameFor).

export type ProviderKind = "stub" | "fal" | "gemini" | "cloudflare";

const TEXT: Record<Exclude<ProviderKind, "stub">, TextClient> = { fal: falText, gemini: geminiText, cloudflare: cloudflareText };
const IMAGE: Record<Exclude<ProviderKind, "stub">, ImageClient> = { fal: falImage, gemini: geminiImage, cloudflare: cloudflareImage };

/** The story context for prompts, the gate for this call, and the name the AI sees. */
function prepare(story: StoryForAi): { ctx: PromptContext; gate: AiGate } {
  const family = story.family ?? NO_FAMILY;
  const base = buildContext(story);
  const aiName = aiNameFor(base.heroName, family);
  return { ctx: { ...base, aiName }, gate: createGate(family, aiName) };
}

const result = <T>(gate: AiGate, client: TextClient | ImageClient, value: T, fallbackUsed: string | null = null): AiResult<T> => ({
  value,
  provider: client.name,
  aiModel: client.model,
  fallback: fallbackUsed !== null,
  fallbackUsed,
  promptVersion: PROMPT_VERSION,
  // The anonymised requests only, for the job record (BE-14).
  aiRequests: gate.sent,
});

/** Step 1: the text AI's scene. Steps 2 and 3 (Visual Brief, Universal Triumph) if it can't help. */
async function sceneFor(text: TextClient | null, ctx: PromptContext, gate: AiGate, panelNumber: number, panelText: string): Promise<Scene> {
  const plan = ctx.plan.find((p) => p.number === panelNumber);
  if (text && plan && panelText.trim()) {
    try {
      const scene = readScene(await text.askText(gate, scenePrompt(ctx, plan, panelText)), ctx.aiName);
      if (scene) return { text: scene, source: "director" };
    } catch (err) {
      // Not a failure of the job: the chain moves on, and the fallback is recorded.
      logger.warn({ panelNumber, reason: err instanceof Error ? err.message : String(err) }, "Scene Director failed; using the fallback");
    }
  }
  return sceneFallback(plan?.role, ctx);
}

/** The provider for one text service and one picture service ("stub" = the fake for that half). */
export function realProvider(textKind: ProviderKind, imageKind: ProviderKind): AiProvider {
  const text = textKind === "stub" ? null : TEXT[textKind];
  const image = imageKind === "stub" ? null : IMAGE[imageKind];

  const words: Pick<AiProvider, "storyText" | "rewritePanels" | "title" | "rewriteSentence" | "comicPage"> = text
    ? {
        async storyText(story) {
          const { ctx, gate } = prepare(story);
          const raw = await text.askText(gate, storyTextPrompt(ctx));
          return result(gate, text, readStoryPanels(raw, ctx.plan.map((p) => p.number), ctx.heroName, ctx.aiName));
        },
        async rewritePanels(story, requests, current) {
          const { ctx, gate } = prepare(story);
          const raw = await text.askText(gate, rewritePrompt(ctx, requests, current));
          return result(gate, text, readStoryPanels(raw, requests.map((r) => r.panelNumber), ctx.heroName, ctx.aiName));
        },
        async title(story) {
          const { ctx, gate } = prepare(story);
          const title = readTitle(await text.askText(gate, titlePrompt(ctx)), ctx.heroName, ctx.aiName);
          return title ? result(gate, text, title) : result(gate, text, fallbackTitle(ctx), "title_formula");
        },
        async rewriteSentence(story, input) {
          const { ctx, gate } = prepare(story);
          const raw = await text.askText(gate, rewriteSentencePrompt(ctx, input));
          // The hero's real name goes back in (if the AI only saw the stand-in).
          return result(gate, text, revealName(raw, ctx.heroName, ctx.aiName));
        },
        async comicPage(story, page, panels, totalPages) {
          const { ctx, gate } = prepare(story);
          const raw = await text.askText(gate, comicPagePrompt(ctx, page, panels, totalPages));
          return result(gate, text, readComicCells(raw, ctx.heroName, ctx.aiName));
        },
      }
    : {
        storyText: (story) => stubProvider.storyText(story),
        rewritePanels: (story, requests, current) => stubProvider.rewritePanels(story, requests, current),
        title: (story) => stubProvider.title(story),
        rewriteSentence: (story, input) => stubProvider.rewriteSentence(story, input),
        comicPage: (story, page, panels, totalPages) => stubProvider.comicPage(story, page, panels, totalPages),
      };

  const panelImage: AiProvider["panelImage"] = image
    ? async (story, panelNumber, panelText, variant = 0) => {
        const { ctx, gate } = prepare(story);
        // A two-act story has no panels 13–15: never draw one.
        if (!ctx.plan.some((p) => p.number === panelNumber)) {
          throw new Error(`Panel ${panelNumber} isn't in this story's plan`);
        }
        const scene = await sceneFor(text, ctx, gate, panelNumber, panelText);
        // The story's own seed keeps the hero looking the same; a redraw nudges it for a new picture.
        const seed = (seedFor(ctx) + variant) % 2_147_483_647;
        const picture = await image.drawImage(gate, { prompt: imagePrompt(ctx, scene.text), seed });
        return result(gate, image, picture, scene.source === "director" ? null : scene.source);
      }
    : (story, panelNumber, panelText, variant) => stubProvider.panelImage(story, panelNumber, panelText, variant);

  const cellImage: AiProvider["cellImage"] = image
    ? async (story, cellNumber, scene, withTempo, shot) => {
        const { ctx, gate } = prepare(story);
        // The story's own seed keeps the hero looking the same in every cell.
        const picture = await image.drawImage(gate, { prompt: comicCellPrompt(ctx, scene, withTempo, shot), seed: seedFor(ctx) });
        return result(gate, image, picture);
      }
    : (story, cellNumber, scene, withTempo, shot) => stubProvider.cellImage(story, cellNumber, scene, withTempo, shot);

  return { ...words, panelImage, cellImage };
}
