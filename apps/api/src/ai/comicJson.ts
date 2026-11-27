import { z } from "zod";
import { BUBBLES, CELLS_PER_PAGE, MIN_TALKING_CELLS, SHOTS, type ComicCellDraft, type Shot } from "../engine/comicPlan.js";
import { revealName } from "./prompts.js";
import { StoryJsonError } from "./storyJson.js";

// Reading the AI's answer for one comic page (guide BE-11): JSON with EXACTLY 4 cells. Anything
// else throws StoryJsonError, so the try fails and the queue retries (on the last try the job
// uses the backup splitter instead, see runJob.ts).

const cellJson = z.object({
  // The narration line is often empty: the picture tells the story.
  caption: z.string().max(1000).nullish(),
  dialogue: z.string().max(500).nullish(),
  bubble: z.string().nullish(),
  tempo: z.string().max(100).nullish(),
  scene: z.string().max(1000).nullish(),
  sfx: z.string().max(100).nullish(),
  shot: z.string().nullish(),
});
const pageJson = z.object({ cells: z.array(cellJson) });

function jsonIn(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new StoryJsonError("The AI's answer had no JSON in it");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new StoryJsonError("The AI's answer wasn't valid JSON");
  }
}

/** The 4 cells, with the hero's real name put back in the words (never in the scene). */
export function readComicCells(raw: string, heroName: string, alias?: string): ComicCellDraft[] {
  const parsed = pageJson.safeParse(jsonIn(raw));
  if (!parsed.success) throw new StoryJsonError("The AI's JSON didn't have the comic page shape");
  const cells = parsed.data.cells;
  if (cells.length !== CELLS_PER_PAGE) throw new StoryJsonError(`Expected ${CELLS_PER_PAGE} cells, got ${cells.length}`);
  // A comic tells its story in bubbles: a page where (almost) nobody talks is tried again.
  const talking = cells.filter((c) => c.dialogue?.trim()).length;
  if (talking < MIN_TALKING_CELLS) throw new StoryJsonError(`Only ${talking} of ${CELLS_PER_PAGE} cells have dialogue (at least ${MIN_TALKING_CELLS} needed)`);
  return cells.map((c) => {
    const bubble = (BUBBLES as readonly string[]).includes(c.bubble ?? "") ? (c.bubble as ComicCellDraft["bubbleType"]) : "none";
    return {
      caption: revealName(c.caption ?? "", heroName, alias),
      dialogue: c.dialogue?.trim() ? revealName(c.dialogue, heroName, alias) : null,
      bubbleType: bubble,
      tempo: c.tempo ?? null,
      sfx: c.sfx ?? null,
      // No (or an unknown) shot: tidyCells gives the panel its shape's default.
      shot: (SHOTS as readonly string[]).includes(c.shot ?? "") ? (c.shot as Shot) : null,
      // The scene goes to the picture AI: it keeps "the hero" (and the stand-in, never the real name).
      scene: [heroName, alias].filter((n): n is string => !!n).reduce((s, n) => s.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "the hero"), c.scene ?? ""),
    };
  });
}
