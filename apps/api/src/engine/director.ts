import { braveStepPhrase, PRACTICE_TAG, type StoryContext } from "./context.js";
import { BEAT_NAMES, type PanelRole } from "./plan.js";
import { BODY_SIGNALS, BRAVE_MOVE_WORDS, OBSTACLE_WORDS, STRENGTH_WORDS } from "./tables.js";

// The STORY DIRECTOR (guide BE-09): what the AI is asked to write, panel by panel, built from
// the same plan and rules the engine checks afterwards. BE-10 sends this to fal.ai and asks
// for JSON in the shape the engine reads (DraftPanel: text, or eight beats).
//
// Decision 7A: the structure comes from the PRD now; the exact wording is tuned in BE-10
// with the real AI (and replaced by the prototype's prompts if Sami Bhai sends them).

export interface PanelBrief {
  number: number;
  label: string;
  act: 1 | 2 | 3;
  instructions: string;
  /** For the brave-move panels: one instruction per beat, in order. */
  beats?: { name: string; instructions: string }[];
}

export interface StoryBrief {
  rules: string[];
  panels: PanelBrief[];
  /** The JSON the AI must answer with. */
  outputShape: string;
}

const obstacle = (ids: string[]) => OBSTACLE_WORDS[ids[0] ?? ""] ?? "a challenge in the way";
const move = (id: string) => BRAVE_MOVE_WORDS[id] ?? "a brave, steady move";

export function directStory(ctx: StoryContext): StoryBrief {
  const a = ctx.answers;
  const hero = ctx.heroName;
  const { subject, possessive } = ctx.pronoun;
  const world = ctx.world ? `${ctx.world.name} (${ctx.world.words.slice(0, 4).join(", ")})` : `the world of the dream "${a.aspiration}"`;
  const strengths = a.charStrengths.map((s) => STRENGTH_WORDS[s] ?? s).join(" and ") || "a quiet inner gift";
  const tools = ctx.toolWords.length ? ` ${hero} uses: ${ctx.toolWords.join(", ")}.` : "";
  const signal = BODY_SIGNALS[ctx.heroType].phrase;

  const beatsFor = (obstacleIds: string[], moveId: string, words: string) =>
    BEAT_NAMES.map((name, i) => ({
      name,
      instructions: [
        `${obstacle(obstacleIds)} confronts ${hero} head-on.`,
        `${hero} names the obstacle in ${possessive} own poetic words.`,
        `${hero}'s body reacts: ${signal}.`,
        `${hero} tries ${move(moveId)} and says, word for word: "${words}"`,
        `The first try fails in a concrete, sensory way; the obstacle does not yield.`,
        `${hero} comes back to ${possessive} grounding (${strengths}).`,
        `${hero} tries again, steadier.`,
        `The obstacle eases a little but stays visible. Never say it vanished, shattered, dissolved, was fixed, solved or gone.`,
      ][i],
    }));

  const brief: Record<PanelRole, string> = {
    identity: `Introduce ${hero} (${subject}) in ${world}.${tools}`,
    gift: `Show ${hero}'s inner gift: ${strengths}.${a.oneMoreAmazingThing ? ` One more amazing thing: ${a.oneMoreAmazingThing}.` : ""}${tools}`,
    call: `${hero} remembers the dream: ${a.aspiration}. Set it in ${world}.`,
    shadow1: `The first shadow appears: ${obstacle(a.obstacles)}.`,
    pivot1: "Write as the eight beats.",
    heavyHeart: `${hero} feels the weight of it (${a.heartColor || "a heavy feeling"}) and keeps going anyway.`,
    rest: `${hero} rests and regroups in a safe place: ${a.safePlaceText || "somewhere calm"}.`,
    shadow2: `A second shadow appears: ${obstacle(a.obstacles2)}.`,
    pivot2: "Write as the eight beats.",
    persistence: `${hero} keeps trying; small steps, no shortcuts.`,
    plateau: `A high point in ${world}: ${hero} sees how far ${subject} has come, earned through effort, not magic.`,
    shadow3: `The greatest challenge and ${hero}'s deepest pause: ${obstacle(a.obstacles3)}. End the panel with the child's words, word for word, in quotes: "${ctx.heroWords[3]}"`,
    pivot3: `${hero} finds a way through by ${move(a.braveMove3)}. Echo the child's Act 3 words in your own words; do not repeat them.`,
    finale: `The Grand Finale in ${world}. Include exactly: "${hero} ${braveStepPhrase(ctx)}". Don't name any strategy label.`,
    anchor: `Speak gently to the reader about trying one small brave step. End with exactly: "${PRACTICE_TAG}"`,
  };

  return {
    rules: [
      `The hero is ${hero}, pronoun "${subject}", the same in every panel. Never use another hero's name or features.`,
      "Never use clinical words (anxiety, rejection, therapy…); use poetic names instead.",
      `Set the story in ${world}.`,
      "Success is earned by effort, never by magic.",
      `Thoughts use single quotes: '…,' ${hero} thought.`,
      "The child's own words appear exactly as written, in quotation marks.",
      "Each act's brave move is a different action.",
      a.storyPath === "two_act" ? "This story has two acts: no third challenge." : "This story has three acts.",
    ],
    panels: ctx.plan.map((p) => ({
      number: p.number,
      label: p.label,
      act: p.act,
      instructions: brief[p.role],
      ...(p.role === "pivot1" && { beats: beatsFor(a.obstacles, a.braveMove, ctx.heroWords[1]) }),
      ...(p.role === "pivot2" && { beats: beatsFor(a.obstacles2, a.braveMove2, ctx.heroWords[2]) }),
    })),
    outputShape: `{ "panels": [ { "number": 1, "text": "…" }, …, { "number": 5, "beats": ["…" ×8] }, … ] } with exactly ${ctx.plan.length} panels`,
  };
}
