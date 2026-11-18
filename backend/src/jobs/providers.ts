import { config } from "../config.js";
import { PANEL_COUNT, type StoryPath } from "../types/story.js";

// Who makes the words and pictures (guide BE-07, BE-10).
//
// Until BE-10 connects fal.ai, the only provider is a STUB: a fake AI that waits a moment and
// returns placeholder text and picture keys. It lets the whole pipeline (queue, retries,
// status, Final Climb) run for real now. BE-10 adds the fal.ai provider behind the same
// shape, and BE-14 puts every fal.ai call through the anonymising gate.

/** What the provider needs to know about a story. */
export interface StoryForAi {
  id: string;
  storyPath: StoryPath;
  charName: string;
  heroType: string | null;
  aspiration: string;
}

export interface AiResult<T> {
  value: T;
  provider: string;
  aiModel: string;
  /** true when a fallback was used instead of the normal answer (BE-10 Scene Director chain). */
  fallback: boolean;
}

export interface AiProvider {
  storyText(story: StoryForAi): Promise<AiResult<string[]>>;
  title(story: StoryForAi): Promise<AiResult<string>>;
  /** Draws one panel; returns the picture's key in OUR bucket (never a web link). */
  panelImage(story: StoryForAi, panelNumber: number): Promise<AiResult<string>>;
}

// ---- The stub --------------------------------------------------------------------------

const DEFAULT_NAMES: Record<string, string> = { fox: "Ember", robot: "Sparky", knight: "Brave" };
const heroName = (story: StoryForAi) => story.charName.trim() || DEFAULT_NAMES[story.heroType ?? ""] || "Sparky";

/**
 * Test controls for the stub (tests only):
 *   failTimes.set("panel_image:3", 2)  → the next 2 tries for panel 3 fail
 *   hangOnce.add("panel_image:3")      → the next try for panel 3 never finishes (a "crash")
 * Keys: "story_text", "title", "panel_image:<n>".
 */
export const stubControls = {
  failTimes: new Map<string, number>(),
  hangOnce: new Set<string>(),
  reset(): void {
    this.failTimes.clear();
    this.hangOnce.clear();
  },
};

async function stubStep(key: string): Promise<void> {
  if (stubControls.hangOnce.delete(key)) await new Promise(() => undefined);
  const failures = stubControls.failTimes.get(key) ?? 0;
  if (failures > 0) {
    stubControls.failTimes.set(key, failures - 1);
    throw new Error(`The stub AI failed on purpose (${key})`);
  }
  await new Promise((resolve) => setTimeout(resolve, config.stubDelayMs));
}

const stub = <T>(value: T): AiResult<T> => ({ value, provider: "stub", aiModel: "stub-v1", fallback: false });

const stubProvider: AiProvider = {
  async storyText(story) {
    await stubStep("story_text");
    const name = heroName(story);
    const count = PANEL_COUNT[story.storyPath];
    return stub(Array.from({ length: count }, (_, i) => `Panel ${i + 1} of ${name}'s story. (Placeholder text: the real story comes in BE-10.)`));
  },
  async title(story) {
    await stubStep("title");
    return stub(`${heroName(story)} and the ${story.aspiration.trim() || "Big Dream"}`);
  },
  async panelImage(story, panelNumber) {
    await stubStep(`panel_image:${panelNumber}`);
    return stub(`stub/${story.id}/panel-${String(panelNumber).padStart(2, "0")}.webp`);
  },
};

export function getProvider(): AiProvider {
  switch (config.aiProvider) {
    case "stub":
      return stubProvider;
  }
}
