import { config } from "../config.js";
import { buildContext, type DraftPanel, type StoryAnswers, type StoryContext } from "../engine/index.js";
import { braveStepPhrase } from "../engine/context.js";
import { BODY_SIGNALS, BRAVE_MOVE_WORDS, OBSTACLE_WORDS, STRENGTH_WORDS } from "../engine/tables.js";

// Who makes the words and pictures (guide BE-07, BE-10).
//
// Until BE-10 connects fal.ai, the only provider is a STUB: a fake AI that waits a moment and
// returns placeholder text and picture keys. It lets the whole pipeline (queue, retries,
// status, the story engine, Final Climb) run for real now. BE-10 adds the fal.ai provider
// behind the same shape, and BE-14 puts every fal.ai call through the anonymising gate.

/** What the provider needs to know about a story: the child's answers, plus its id. */
export type StoryForAi = StoryAnswers & { id: string };

export interface AiResult<T> {
  value: T;
  provider: string;
  aiModel: string;
  /** true when a fallback was used instead of the normal answer (BE-10 Scene Director chain). */
  fallback: boolean;
}

/** A panel the engine wants rewritten, and why. */
export interface RewriteRequest {
  panelNumber: number;
  reasons: string[];
}

export interface AiProvider {
  /** The whole story as panels (brave-move panels as eight beats), for the engine to check. */
  storyText(story: StoryForAi): Promise<AiResult<DraftPanel[]>>;
  /** Rewrites only the panels the engine sent back (BE-09). */
  rewritePanels(story: StoryForAi, requests: RewriteRequest[], current: DraftPanel[]): Promise<AiResult<DraftPanel[]>>;
  title(story: StoryForAi): Promise<AiResult<string>>;
  /** Draws one panel; returns the picture's key in OUR bucket (never a web link). */
  panelImage(story: StoryForAi, panelNumber: number): Promise<AiResult<string>>;
}

// ---- The stub --------------------------------------------------------------------------

/**
 * Test controls for the stub (tests only):
 *   failTimes.set("panel_image:3", 2)   → the next 2 tries for panel 3 fail
 *   hangOnce.add("panel_image:3")       → the next try for panel 3 never finishes (a "crash")
 *   brokenPanel.set(6, 2)               → the next 2 times panel 6 is written, it comes out
 *                                          missing (so the engine asks for a rewrite)
 * Keys: "story_text", "title", "panel_image:<n>".
 */
export const stubControls = {
  failTimes: new Map<string, number>(),
  hangOnce: new Set<string>(),
  brokenPanel: new Map<number, number>(),
  reset(): void {
    this.failTimes.clear();
    this.hangOnce.clear();
    this.brokenPanel.clear();
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

/** true (and counts down) when this panel should come out broken this time. */
function brokenThisTime(panelNumber: number): boolean {
  const left = stubControls.brokenPanel.get(panelNumber) ?? 0;
  if (left <= 0) return false;
  stubControls.brokenPanel.set(panelNumber, left - 1);
  return true;
}

const say = (words: string) => (/[.!?]$/.test(words) ? words : `${words}.`);

/**
 * Placeholder text for one panel that follows the story rules, so the engine passes it.
 * The real story text comes from fal.ai in BE-10. The Practice Anchor deliberately leaves
 * out "One real step today." so you can see the engine repair it (logged on the job).
 */
function stubPanel(ctx: StoryContext, number: number): DraftPanel {
  const a = ctx.answers;
  const hero = ctx.heroName;
  const { subject, object, possessive } = ctx.pronoun;
  const He = subject.charAt(0).toUpperCase() + subject.slice(1);
  const place = ctx.world?.words[0] ?? "path";
  const signal = BODY_SIGNALS[ctx.heroType].phrase;
  const strength = STRENGTH_WORDS[a.charStrengths[0] ?? ""] ?? "quiet courage";
  const tools = ctx.toolWords.length ? ` ${He} carried ${ctx.toolWords.join(" and ")} with ${object}.` : "";
  const obstacle = (ids: string[]) => OBSTACLE_WORDS[ids[0] ?? ""] ?? "a stubborn challenge";
  const move = (id: string) => BRAVE_MOVE_WORDS[id] ?? "a steady new idea";
  const role = ctx.plan.find((p) => p.number === number)!.role;

  // Each act's brave move must be a different action (rule R8), so the two brave-move
  // panels use different sentences.
  const firstBeats = (shadow: string, how: string, words: string) => [
    `In the ${place}, ${shadow} rose up in front of ${hero}.`,
    `${hero} called it a cloud that would not move.`,
    `${hero}'s ${signal}.`,
    `${hero} began ${how}. ${hero} said, "${say(words)}"`,
    `${shadow} stayed exactly where it was, and ${hero} slipped backwards into a puddle.`,
    `${hero} took a slow breath and held on to ${possessive} ${strength}.`,
    `Steadier now, ${hero} stepped forward a second time.`,
    `${shadow} eased a little and made room, though it was still there.`,
  ];
  const secondBeats = (shadow: string, how: string, words: string) => [
    `Further along, ${shadow} blocked the bright corner of the ${place}.`,
    `${hero} named it a locked window.`,
    `${hero}'s ${signal}.`,
    `This time ${hero} chose ${how}. ${hero} said, "${say(words)}"`,
    `Nothing changed at first, and a cold wind pushed against ${possessive} face.`,
    `Remembering the earlier day, ${hero} planted ${possessive} feet firmly.`,
    `With calm patience, ${hero} found a different angle and leaned in.`,
    `A small gap opened beside ${shadow}, which still stood nearby.`,
  ];

  const text: Record<string, string> = {
    identity: `${hero} lived near the ${place}. (Placeholder story until BE-10.)`,
    gift: `${hero} had ${strength}.${tools} 'Maybe I can,' ${hero} thought.`,
    call: `${hero} dreamed of the ${place} and of ${a.aspiration}.`,
    shadow1: `Then ${obstacle(a.obstacles)} blocked the way.`,
    heavyHeart: `${hero} felt heavy for a while, but ${subject} stayed.`,
    rest: `${hero} rested in ${a.safePlaceText || "a quiet corner"} until ${possessive} strength came back.`,
    shadow2: `Later, ${obstacle(a.obstacles2)} appeared.`,
    persistence: `${hero} kept trying, one small step after another.`,
    plateau: `${hero} looked across the ${place} and saw how far ${possessive} effort had carried ${object}.`,
    shadow3: `Then ${obstacle(a.obstacles3)} rose up, and ${hero} sat down, very tired. "${ctx.heroWords[3]}"`,
    pivot3: `Holding on to that promise, ${hero} kept on ${move(a.braveMove3)} until a way through appeared.`,
    finale: `In the ${place}, ${hero} ${braveStepPhrase(ctx)}.`,
    anchor: `When something feels hard, you can try one small brave step too.`,
  };

  if (role === "pivot1") return { number, beats: firstBeats(obstacle(a.obstacles), move(a.braveMove), ctx.heroWords[1]) };
  if (role === "pivot2") return { number, beats: secondBeats(obstacle(a.obstacles2), move(a.braveMove2), ctx.heroWords[2]) };
  return { number, text: text[role] };
}

const stub = <T>(value: T): AiResult<T> => ({ value, provider: "stub", aiModel: "stub-v1", fallback: false });

const stubProvider: AiProvider = {
  async storyText(story) {
    await stubStep("story_text");
    const ctx = buildContext(story);
    // A "broken" panel is simply left out, like the prototype's AI skipping Panel 6 (defect 5).
    return stub(ctx.plan.filter((p) => !brokenThisTime(p.number)).map((p) => stubPanel(ctx, p.number)));
  },
  async rewritePanels(story, requests) {
    await stubStep("story_text");
    const ctx = buildContext(story);
    return stub(requests.map(({ panelNumber }) => (brokenThisTime(panelNumber) ? { number: panelNumber, text: "" } : stubPanel(ctx, panelNumber))));
  },
  async title(story) {
    await stubStep("title");
    return stub(`${buildContext(story).heroName} and the ${story.aspiration.trim() || "Big Dream"}`);
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
