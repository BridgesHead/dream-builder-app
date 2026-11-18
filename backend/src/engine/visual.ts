import { createHash } from "node:crypto";
import type { StoryContext } from "./context.js";
import type { PanelRole } from "./plan.js";
import type { HeroType } from "./tables.js";

// What the PICTURES must look like (guide BE-10, PRD F6). No HTTP, no database.
//
//   picture prompt = style (by mode) + Character Blueprint (by hero) + dream-world costume
//                    + tools + the scene + "no words in the picture"
//   seed           = a fixed number from hero name + dream, the same for every panel
//   scene          = Scene Director (AI) → Visual Brief table → Universal Triumph
//
// ⚠️ STARTER TABLES, like tables.ts: built from the PRD's examples. Replace them with the
// prototype's when Sami Bhai sends them; the code that uses them doesn't change.

/** Explorer (junior) = storybook watercolour; Creator (senior) = concept art (PRD F6). */
export const STYLES: Record<"junior" | "senior", string> = {
  junior:
    "2D flat watercolour sketch on cream textured paper, soft pencil outlines, gentle muted colours, classic hand-drawn storybook illustration",
  senior:
    "dramatic cinematic concept art, painterly detail, rich lighting and depth, adventurous mood, digital illustration",
};

/** The hero's fixed look, on EVERY panel, so the hero never changes (PRD F6). */
export const CHARACTER_BLUEPRINTS: Record<HeroType, string> = {
  robot:
    "the hero is a small friendly robot with a round brass torso, one large round glowing porthole eye, riveted copper arms and little gears at the joints",
  fox: "the hero is a young red fox with a bushy golden-tipped tail, bright amber eyes, white chest fur and small black paws",
  knight:
    "the hero is a young knight in simple silver armour with a round blue shield on one arm and a small helmet with the visor raised, showing a kind face",
};

/** Dream-world costuming (PRD F6): keyed by the dream-world name in tables.ts. */
export const COSTUMES: Record<string, string> = {
  space: "wearing a little white space helmet",
  football: "wearing a football kit with shin pads",
  kitchen: "wearing a tall chef hat and an apron",
  animals: "wearing a small vet's coat with a stethoscope",
  hospital: "wearing a doctor's coat with a stethoscope",
  stage: "holding a microphone",
  music: "carrying a musical instrument",
  studio: "wearing a paint-splashed smock and holding a brush",
  dance: "wearing a ballet tutu and dance shoes",
  workshop: "wearing goggles and a tool belt",
  library: "carrying a notebook and pencil",
  classroom: "carrying a stack of books",
  sky: "wearing a pilot's cap and goggles",
};

/** "[HeroName] and the [Poetic Version of the Dream]" (PRD F12), when the AI's title can't be used. */
export const POETIC_DREAMS: Record<string, string> = {
  space: "Silver Stars",
  football: "Emerald Pitch",
  kitchen: "Golden Recipe",
  animals: "Healing Meadow",
  hospital: "Gentle Lantern",
  stage: "Singing Light",
  music: "Hidden Melody",
  studio: "Rainbow Canvas",
  dance: "Moonlit Stage",
  workshop: "Clockwork Dream",
  library: "Endless Pages",
  classroom: "Lantern of Learning",
  sky: "Open Sky",
};
export const POETIC_DREAM_FALLBACK = "Brightest Dream";

export function fallbackTitle(ctx: StoryContext): string {
  return `${ctx.heroName} and the ${(ctx.world && POETIC_DREAMS[ctx.world.name]) || POETIC_DREAM_FALLBACK}`;
}

/**
 * The Visual Brief table: the scene for each panel when the Scene Director AI can't help.
 * {place} is the dream world's main word ("clinic"), or "a bright open landscape".
 */
export const VISUAL_BRIEFS: Partial<Record<PanelRole, string>> = {
  identity: "the hero standing happily in {place}, morning light, a welcoming wide view",
  gift: "a close-up of the hero smiling warmly, a soft glow around them",
  call: "the hero looking up at {place} in the distance, full of wonder",
  shadow1: "a large shadowy obstacle blocking the path through {place}, the hero small in front of it",
  pivot1: "the hero stepping forward bravely towards the obstacle in {place}",
  heavyHeart: "the hero sitting quietly with a heavy heart, soft blue tones, in {place}",
  rest: "the hero resting in a cosy, safe hideaway, warm light",
  shadow2: "a new obstacle rising in {place}, the hero watching it carefully",
  pivot2: "the hero trying a new brave idea in front of the obstacle in {place}",
  persistence: "the hero climbing a winding path through {place}, one step at a time",
  plateau: "the hero on a high point looking back over {place}, proud and tired",
  shadow3: "the hero pausing before the biggest obstacle yet in {place}, dusk light",
  pivot3: "the hero finding a way around the obstacle in {place}, steady and calm",
  finale: "the hero taking a confident step forward in {place}, golden light",
  anchor: "the hero waving gently goodbye on a small path at sunset",
};

/** The last fallback: a scene that suits ANY panel (PRD F6). */
export const UNIVERSAL_TRIUMPH = "the hero standing proudly on a sunny hilltop, arms raised, a winding path behind them";

export interface Scene {
  text: string;
  source: "director" | "visual_brief" | "universal_triumph";
}

/** Steps 2 and 3 of the chain: the Visual Brief row, else Universal Triumph. */
export function sceneFallback(role: PanelRole | undefined, ctx: StoryContext, table = VISUAL_BRIEFS): Scene {
  const row = role ? table[role] : undefined;
  if (!row) return { text: UNIVERSAL_TRIUMPH, source: "universal_triumph" };
  const place = ctx.world ? `the ${ctx.world.words[0]}` : "a bright open landscape";
  return { text: row.replaceAll("{place}", place), source: "visual_brief" };
}

/** The same number for every panel of a story: hero name + dream (PRD F6). */
export function seedFor(ctx: StoryContext): number {
  const digest = createHash("sha256").update(`${ctx.heroName.toLowerCase()}|${ctx.answers.aspiration.trim().toLowerCase()}`).digest();
  return digest.readUInt32BE(0) % 2_147_483_647;
}

/** The full FLUX prompt for one panel. Never contains the child's or hero's name. */
export function imagePrompt(ctx: StoryContext, scene: string): string {
  const costume = ctx.world ? COSTUMES[ctx.world.name] : undefined;
  const tools = ctx.toolWords.length ? `with ${ctx.toolWords.join(" and ")}` : "";
  return [
    STYLES[ctx.answers.mode === "senior" ? "senior" : "junior"],
    [CHARACTER_BLUEPRINTS[ctx.heroType], costume, tools].filter(Boolean).join(", "),
    `Scene: ${scene}`,
    "The same hero in every picture. No text, no words, no letters, no speech bubbles.",
  ].join(". ");
}
