import { falProvider } from "../ai/falProvider.js";
import { stubProvider } from "../ai/stubProvider.js";
import { config } from "../config.js";
import type { DraftPanel, StoryAnswers } from "../engine/index.js";

// Who makes the words and pictures (guide BE-07, BE-10). Both providers have the same shape,
// so the queue, the jobs and the story engine never care which one is running:
//
//   AI_PROVIDER=fal    the real AI (src/ai/falProvider.ts)
//   AI_PROVIDER=stub   a fake AI for tests and PCs without a fal.ai key (src/ai/stubProvider.ts)
//
// BE-14 puts every fal.ai call through the anonymising gate (src/ai/falClient.ts).

export { stubControls } from "../ai/stubProvider.js";

/** What the provider needs to know about a story: the child's answers, plus its id. */
export type StoryForAi = StoryAnswers & { id: string };

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
}

/** A panel the engine wants rewritten, and why. */
export interface RewriteRequest {
  panelNumber: number;
  reasons: string[];
}

/** A finished picture, ready to be saved in OUR storage (never a fal.ai link). */
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
  switch (config.aiProvider) {
    case "fal":
      return falProvider;
    case "stub":
      return stubProvider;
  }
}
