import { createHash } from "node:crypto";
import type { StoryContext } from "./context.js";
import type { PanelRole } from "./plan.js";
import type { HeroType } from "./tables.js";
import type { Shot } from "./comicPlan.js";

// What the PICTURES must look like (guide BE-10, PRD F6). No HTTP, no database.
//
//   picture prompt = style (the look the child picked, toned by mode) + Character Blueprint (by hero) + dream-world costume
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

/**
 * The look the child picks on the style screen ("How should your story look?"), for storybooks
 * and comics alike. It sets the drawing style; the mode keeps it right for the child's age.
 */
export const ART_STYLE_PROMPTS: Record<string, string> = {
  "soft-peaceful": "soft and peaceful illustration, gentle pastel colours, light airy watercolour washes, rounded shapes, calm quiet mood",
  "clear-bold": "clear and bold illustration, bright saturated colours, clean confident outlines, simple easy-to-read shapes, high contrast",
  "indie-graphic-novel": "indie graphic novel style, dramatic deep ink lines, strong shadows, limited moody colour palette, cinematic framing",
};
const AGE_TONE: Record<"junior" | "senior", string> = {
  junior: "a warm children's picture book for ages 8 to 11",
  senior: "an adventurous illustrated book for ages 12 to 14",
};

/** The style line: the child's chosen look if there is one, otherwise the mode's default (PRD F6). */
export function styleFor(ctx: StoryContext): string {
  const mode = ctx.answers.mode === "senior" ? "senior" : "junior";
  const chosen = ctx.answers.comicVibe ? ART_STYLE_PROMPTS[ctx.answers.comicVibe] : undefined;
  return chosen ? `${chosen}, ${AGE_TONE[mode]}` : STYLES[mode];
}

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
    styleFor(ctx),
    [CHARACTER_BLUEPRINTS[ctx.heroType], costume, tools].filter(Boolean).join(", "),
    `Scene: ${scene}`,
    "The same hero in every picture. No text, no words, no letters, no speech bubbles.",
  ].join(". ");
}

// The camera, in words the picture AI understands. The hero stays near the middle, because a
// wide or tall panel shows a cropped part of the (square) picture.
const SHOT_WORDS: Record<Shot, string> = {
  wide: "wide establishing shot: the whole setting is visible, the hero small but clear in the centre",
  medium: "medium shot: the hero from the waist up, centred, the setting behind",
  close: "close-up: the hero's face and feelings fill the frame, centred",
  full: "full-body shot: the hero from head to toe in the centre, with space above and below",
};

/**
 * The picture prompt for one comic panel (BE-11): the child's chosen look as a comic panel,
 * the camera shot that fits the panel's shape, the same hero as every panel, ONE action, and
 * Tempo the musical squirrel when the panel has his notes. No words in the picture: the book
 * draws the balloons, the narration and the sound effects.
 */
export function comicCellPrompt(ctx: StoryContext, scene: string, withTempo: boolean, shot: Shot | null = null): string {
  const costume = ctx.world ? COSTUMES[ctx.world.name] : undefined;
  const tools = ctx.toolWords.length ? `with ${ctx.toolWords.join(" and ")}` : "";
  return [
    `${styleFor(ctx)}, a single panel from a premium children's comic book, confident clean ink outlines, bold clear shapes, rich lighting`,
    SHOT_WORDS[shot ?? "medium"],
    [CHARACTER_BLUEPRINTS[ctx.heroType], costume, tools].filter(Boolean).join(", "),
    `Scene, one single moment: ${scene}`,
    "Expressive face and body language that show the feeling, a dynamic pose, a simple uncluttered background, strong silhouette",
    ...(withTempo ? ["A small friendly squirrel with headphones, Tempo, sways to music nearby"] : []),
    "The same hero in every panel. No text, no words, no letters, no speech bubbles, no panel borders.",
  ].join(". ");
}
