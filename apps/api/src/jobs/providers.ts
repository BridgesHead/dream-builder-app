import type { FamilyDetails } from "../ai/anonymise.js";
import type { SentRequest } from "../ai/gate.js";
import { realProvider } from "../ai/realProvider.js";
import { stubProvider } from "../ai/stubProvider.js";
import { config } from "../config.js";
import type { ComicCellDraft, ComicPagePlan, Shot } from "../engine/comicPlan.js";
import type { DraftPanel, StoryAnswers } from "../engine/index.js";

// Who makes the words and pictures (guide BE-07, BE-10). Every provider has the same shape,
// so the queue, the jobs and the story engine never care which one is running:
//
//   AI_PROVIDER=stub                  a fake AI for tests and PCs without a key (src/ai/stubProvider.ts)
//   AI_PROVIDER=fal                   fal.ai for text and pictures (the real AI)
//   AI_PROVIDER=gemini | cloudflare   that service for both
//
// AI_TEXT_PROVIDER and AI_IMAGE_PROVIDER, when set, pick each half on its own, e.g. the FREE
// mix: AI_TEXT_PROVIDER=gemini + AI_IMAGE_PROVIDER=cloudflare (src/ai/realProvider.ts).
// Every AI call goes through the anonymising gate (BE-14, src/ai/gate.ts).

export { stubControls } from "../ai/stubProvider.js";

/**
 * What the provider needs to know about a story: the child's answers, plus its id, plus the
 * family's details for the anonymising gate (BE-14) to keep OUT of every request. Without
 * `family` the gate still removes emails, phones, links, addresses and schools, and the AI
 * sees the hero's stand-in name.
 */
export type StoryForAi = StoryAnswers & { id: string; family?: FamilyDetails };

export interface AiResult<T> {
  value: T;
  provider: string;
  aiModel: string;
  /** true when a fallback was used instead of the normal answer (BE-10). */
  fallback: boolean;
  /** Which fallback, e.g. "visual_brief", "universal_triumph", "title_formula". */
  fallbackUsed: string | null;
  /** Which version of our prompts made it (null for the stub). */
  promptVersion: string | null;
  /** What was sent to the AI, AFTER anonymising (BE-14). The job keeps these. Empty for the stub. */
  aiRequests?: SentRequest[];
}

/** A panel the engine wants rewritten, and why. */
export interface RewriteRequest {
  panelNumber: number;
  reasons: string[];
}

/** A finished picture, ready to be saved in OUR storage (never an AI service link). */
export interface PanelPicture {
  body: Uint8Array;
  contentType: string;
  ext: string;
}

export interface AiProvider {
  /** The whole story as panels (brave-move panels as eight beats), for the engine to check. */
  storyText(story: StoryForAi): Promise<AiResult<DraftPanel[]>>;
  /** Rewrites only the panels the engine sent back (BE-09). */
  rewritePanels(story: StoryForAi, requests: RewriteRequest[], current: DraftPanel[]): Promise<AiResult<DraftPanel[]>>;
  title(story: StoryForAi): Promise<AiResult<string>>;
  /**
   * Draws one panel from its saved text. `variant` is 0 for the first picture and 1, 2, … for
   * redraws (BE-12), so a redraw doesn't come out exactly the same as before.
   */
  panelImage(story: StoryForAi, panelNumber: number, panelText: string, variant?: number): Promise<AiResult<PanelPicture>>;
  /**
   * The Creator-mode rewriter (BE-12): ONE other way to say `sentence`, from the panel it's in.
   * The caller checks the answer against the rules (src/engine/rewriteCheck.ts) and asks again.
   */
  rewriteSentence(story: StoryForAi, input: RewriteSentenceInput): Promise<AiResult<string>>;
  /** One comic page (BE-11): 4 cells re-telling the page's story panels. The job tidies them. */
  comicPage(story: StoryForAi, page: ComicPagePlan, panels: ComicPanelText[], totalPages: number): Promise<AiResult<ComicCellDraft[]>>;
  /** Draws one comic cell (1–40) from its scene. */
  /** `shot`: the camera shot that fits the panel's shape (wide / medium / close / full). */
  cellImage(story: StoryForAi, cellNumber: number, scene: string, withTempo: boolean, shot?: Shot | null): Promise<AiResult<PanelPicture>>;
}

/** A story panel as a comic page needs it. */
export interface ComicPanelText {
  number: number;
  label: string;
  text: string;
}

export interface RewriteSentenceInput {
  sentence: string;
  /** The whole panel text, so the new sentence fits around it. */
  panelText: string;
  maxWords: number;
  /** Which try this is (0 = first). Lets the AI hear why the last try was refused. */
  attempt: number;
  /** Why the last try was refused, if it was. */
  problems: string[];
}

export function getProvider(): AiProvider {
  // Read each time, so a test can switch providers by changing config.
  const textKind = config.aiTextProvider ?? config.aiProvider;
  const imageKind = config.aiImageProvider ?? config.aiProvider;
  if (textKind === "stub" && imageKind === "stub") return stubProvider;
  return realProvider(textKind, imageKind);
}
