import { z } from "zod";
import type { DraftPanel } from "../engine/types.js";
import { revealName } from "./prompts.js";

// Reading the AI's story answer (guide BE-10): it must be JSON with EXACTLY the panels asked
// for. Anything else throws StoryJsonError, the try fails, and the queue retries (BE-07).
// After the last try the story is marked failed: never saved half-built.

export class StoryJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryJsonError";
  }
}

const panelJson = z.object({
  number: z.number().int(),
  text: z.string().max(4000).nullish(),
  beats: z.array(z.string().max(1000)).max(12).nullish(),
});
const storyJson = z.object({ panels: z.array(panelJson).max(20) });

/** The JSON inside the AI's answer, also when wrapped in ```json … ``` or with words around it. */
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

/**
 * The panels from the AI's answer. `expected` = the panel numbers asked for (1–12 or 1–15 for
 * a whole story; only the sent-back ones for a rewrite). The hero's real name is put back in.
 */
export function readStoryPanels(raw: string, expected: number[], heroName: string): DraftPanel[] {
  const parsed = storyJson.safeParse(jsonIn(raw));
  if (!parsed.success) throw new StoryJsonError("The AI's JSON didn't have the panel shape");
  const panels = parsed.data.panels;
  const got = panels.map((p) => p.number).sort((a, b) => a - b);
  const want = [...expected].sort((a, b) => a - b);
  if (got.length !== want.length || got.some((n, i) => n !== want[i])) {
    throw new StoryJsonError(`Expected ${want.length} panels (${want.join(", ")}), got ${got.length} (${got.join(", ") || "none"})`);
  }
  return panels
    .map((p) => ({
      number: p.number,
      ...(p.beats ? { beats: p.beats.map((b) => revealName(b, heroName)) } : { text: revealName(p.text ?? "", heroName) }),
    }))
    .sort((a, b) => a.number - b.number);
}
