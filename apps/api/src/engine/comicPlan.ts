import type { StoryPath } from "../types/story.js";
import { planFor, type PanelRole } from "./plan.js";

// The comic version of a story (guide BE-11, PRD F7). No HTTP, no database.
//
//   two_act   8 pages × 4 cells = 32 cells
//   three_act 10 pages × 4 cells = 40 cells
//
// THE BEAT-TO-CELL MAPPING: which story panels each comic page tells. A brave-move panel
// (the eight beats) gets a whole page: two beats per cell. A two-act comic never gets a
// third-act cell, because its pages only list two-act panels.
//
// ⚠️ DRAFT MAPPING (Anas, 2026-11-25). The guide says Sami Bhai approves it (PRD F7). Changing
// it is only an edit of COMIC_PAGES below; the code that uses it doesn't change.

export const CELLS_PER_PAGE = 4;

export const COMIC_PAGES: Record<StoryPath, number[][]> = {
  two_act: [[1, 2], [3, 4], [5], [6, 7], [8], [9], [10], [11, 12]],
  three_act: [[1, 2], [3, 4], [5], [6, 7], [8], [9], [10, 11], [12], [13], [14, 15]],
};

export const COMIC_CELL_COUNT: Record<StoryPath, number> = {
  two_act: COMIC_PAGES.two_act.length * CELLS_PER_PAGE,
  three_act: COMIC_PAGES.three_act.length * CELLS_PER_PAGE,
};

// Tempo, the musical squirrel, visits the calm moments only: the rest and the closing page.
const TEMPO_ROLES: PanelRole[] = ["rest", "anchor"];

export interface ComicPagePlan {
  page: number;
  /** The story panels this page tells, e.g. [6, 7]. */
  panels: number[];
  roles: PanelRole[];
  labels: string[];
  /** Tempo may appear on this page (at most one cell). */
  tempoAllowed: boolean;
  /** The act of the brave move this page shows (its hero words become speech), or null. */
  braveAct: 1 | 2 | 3 | null;
  /** How the page's 4 panels are arranged (see LAYOUTS). */
  layout: ComicLayout;
}

// ---- Page layouts ------------------------------------------------------------------
//
// Like a real comic, the panels change shape with the moment (still 4 panels a page):
//
//   big_top     a big wide panel (where are we?), then 3 small ones   ← opening pages
//   big_bottom  3 small panels, then a big one for the big moment     ← brave moves, the ending
//   tall        a tall panel, a wide one, 2 small                     ← action pages
//   grid        4 equal panels                                        ← calm pages
//
// The shape of each panel decides its camera shot (a wide panel gets a wide view, a small one a
// close-up or medium shot), so the picture fits the frame it goes in.

export const LAYOUTS = ["big_top", "big_bottom", "tall", "grid"] as const;
export type ComicLayout = (typeof LAYOUTS)[number];
export type PanelShape = "big" | "wide" | "tall" | "small" | "square";
export const SHOTS = ["wide", "medium", "close", "full"] as const;
export type Shot = (typeof SHOTS)[number];

export const PANEL_SHAPES: Record<ComicLayout, PanelShape[]> = {
  big_top: ["big", "small", "small", "small"],
  big_bottom: ["small", "small", "small", "big"],
  tall: ["tall", "wide", "small", "small"],
  grid: ["square", "square", "square", "square"],
};

/** The shots each panel shape allows; the first is the default. */
export const SHOTS_FOR: Record<PanelShape, Shot[]> = {
  big: ["wide", "medium"],
  wide: ["wide", "medium"],
  tall: ["full", "medium"],
  small: ["close", "medium"],
  square: ["medium", "close", "wide"],
};

const SHAPE_WORDS: Record<PanelShape, string> = {
  big: "a BIG panel across the page (the moment to remember)",
  wide: "a wide, short panel",
  tall: "a tall, narrow panel",
  small: "a small panel",
  square: "a square panel",
};
export const shapeWords = (shape: PanelShape) => SHAPE_WORDS[shape];

function layoutFor(page: number, pages: number, roles: PanelRole[], braveAct: number | null, calm: boolean): ComicLayout {
  if (page === 1) return "big_top";
  if (braveAct || page === pages) return "big_bottom";
  if (calm) return "grid";
  // A new obstacle arrives: show the place again with a big panel.
  if (roles.some((r) => r === "shadow1" || r === "shadow2" || r === "shadow3")) return "big_top";
  return page % 2 === 0 ? "tall" : "grid";
}

export function comicPlanFor(path: StoryPath): ComicPagePlan[] {
  const plan = planFor(path);
  return COMIC_PAGES[path].map((panels, i) => {
    const rows = panels.map((n) => plan.find((p) => p.number === n)!);
    const roles = rows.map((r) => r.role);
    const brave = roles.find((r) => r === "pivot1" || r === "pivot2" || r === "pivot3");
    const braveAct = brave === "pivot1" ? 1 : brave === "pivot2" ? 2 : brave === "pivot3" ? 3 : null;
    const tempoAllowed = roles.some((r) => TEMPO_ROLES.includes(r));
    return {
      page: i + 1,
      panels,
      roles,
      labels: rows.map((r) => r.label),
      tempoAllowed,
      braveAct,
      layout: layoutFor(i + 1, COMIC_PAGES[path].length, roles, braveAct, tempoAllowed),
    };
  });
}

/** The number (1–40) of a cell across the whole comic: page 2, cell 1 → 5. */
export const cellIndex = (page: number, cell: number) => (page - 1) * CELLS_PER_PAGE + cell;
/** The other way round: 5 → page 2, cell 1. */
export const cellPosition = (index: number) => ({ page: Math.ceil(index / CELLS_PER_PAGE), cell: ((index - 1) % CELLS_PER_PAGE) + 1 });

// Music notation only: notes, rests, clefs, accidentals, bar lines and spaces (PRD F7: Tempo's
// bubble never holds words).
const MUSIC = /[♩-♯\u{1D100}-\u{1D1FF}|]/u;

/** Tempo's bubble: only music symbols kept (at most 8), or null if nothing musical is left. */
export function cleanTempo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const notes = [...raw].filter((ch) => MUSIC.test(ch)).slice(0, 8);
  return notes.length ? notes.join(" ") : null;
}

// Balloon shapes, as in real comics: speech (oval), thought (cloud), whisper (dashed), shout (spiky).
export const BUBBLES = ["speech", "thought", "whisper", "shout", "none"] as const;
export type Bubble = (typeof BUBBLES)[number];

/** One cell as the script makes it (before it gets a picture). */
export interface ComicCellDraft {
  /** The picture-book line under the panel: often empty (the picture tells the story). */
  caption: string;
  dialogue: string | null;
  bubbleType: Bubble;
  tempo: string | null;
  /** A sound effect drawn on the picture ("WHOOSH!"), at most one a page, or null. */
  sfx: string | null;
  /** The camera shot (fits the panel's shape). */
  shot: Shot | null;
  /** What the picture shows ("the hero …"), never a name. */
  scene: string;
}

// Children's picture books: very few words; the picture tells the story. What the AI is asked for ...
export const NARRATION_WORDS = 12;
export const BUBBLE_WORDS = 10;
/** Panels on a page that may have a narration line (the rest are pictures and balloons only). */
export const MAX_NARRATED_CELLS = 2;
// ... and the hard limits the rules cut to (the backup splitter's lines are longer, so no part
// of the story is lost).
export const MAX_CAPTION_WORDS = 30;
export const MAX_DIALOGUE_WORDS = 14;
/** At least this many of a page's 4 cells have a balloon, or the AI's page is tried again. */
export const MIN_TALKING_CELLS = 2;

/** A sound effect: one or two words in capitals, e.g. "WHOOSH!", "CLANG!", "BZZZ!". */
export function cleanSfx(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/[^A-Z!?.\- ]/g, "").replace(/\s+/g, " ");
  if (!/[A-Z]{2}/.test(s) || s.split(" ").length > 2 || s.length > 14) return null;
  return s;
}

// The story's inner workings must never reach the page: the plan's labels ("First Pivot",
// "The Shadow") and words like "brave move".
const INNER_WORDS = /\b(brave moves?|pivots?|act (one|two|three|[123])|panel \d+|practice anchor|identity anchor|internal gift|plateau triumph|grand finale|deepest pause|(first|second|third) shadow)\b/i;
export function storyWordsOnly(text: string, plan: ComicPagePlan): string {
  const t = text.trim();
  if (!t) return "";
  const bare = t.toLowerCase().replace(/[.!…:]+$/, "");
  // A line that IS a label ("The Call.", "Persistence") or holds an inner word.
  if (plan.labels.some((l) => bare === l.toLowerCase())) return "";
  return INNER_WORDS.test(t) ? "" : t;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const cut = (s: string, max: number) => {
  const w = words(s);
  return w.length <= max ? s.trim() : `${w.slice(0, max).join(" ").replace(/[,;:]+$/, "")}…`;
};

/**
 * Makes four cells keep the comic's rules, whatever the AI wrote:
 *   - narration short and only on a couple of panels; never the story's inner labels
 *   - dialogue short, with a balloon only when there IS dialogue
 *   - Tempo only where allowed, music only, at most one cell per page
 *   - one sound effect a page at most, capitals only
 *   - each panel's shot fits its shape
 *   - on a brave-move page the hero's own brave words are spoken (speech balloon)
 */
export function tidyCells(cells: ComicCellDraft[], plan: ComicPagePlan, heroWords: string, heroLabel: string): ComicCellDraft[] {
  let tempoUsed = false;
  let sfxUsed = false;
  let narrated = 0;
  const shapes = PANEL_SHAPES[plan.layout];
  const tidy = cells.slice(0, CELLS_PER_PAGE).map((c, i) => {
    const dialogue = c.dialogue?.trim() ? storyWordsOnly(cut(c.dialogue.trim(), MAX_DIALOGUE_WORDS), plan) || null : null;
    let tempo = plan.tempoAllowed && !tempoUsed ? cleanTempo(c.tempo) : null;
    if (tempo) tempoUsed = true;
    else tempo = null;
    const sfx = sfxUsed ? null : cleanSfx(c.sfx);
    if (sfx) sfxUsed = true;
    let caption = storyWordsOnly(cut(c.caption ?? "", MAX_CAPTION_WORDS), plan);
    if (caption && narrated >= MAX_NARRATED_CELLS && dialogue) caption = "";
    if (caption) narrated += 1;
    const allowed = SHOTS_FOR[shapes[i] ?? "square"];
    return {
      caption,
      dialogue,
      bubbleType: dialogue ? (c.bubbleType === "none" ? "speech" : c.bubbleType) : ("none" as Bubble),
      tempo,
      sfx,
      shot: c.shot && allowed.includes(c.shot) ? c.shot : allowed[0],
      scene: c.scene.trim() || `${heroLabel} in the story`,
    };
  });
  const brave = heroWords.trim().replace(/^["“']+|["”']+$/g, "");
  if (plan.braveAct && brave && !tidy.some((c) => c.dialogue && c.dialogue.toLowerCase().includes(brave.toLowerCase().slice(0, 20)))) {
    // Cell 2 holds the Signal and the Try: the moment the hero says the brave words.
    tidy[1] = { ...tidy[1], dialogue: cut(brave, MAX_DIALOGUE_WORDS), bubbleType: "speech" };
  }
  return tidy;
}

// Words in quotes, "…" or “…”.
const QUOTED = /["“]([^"”]{2,})["”]/g;

/**
 * The backup script (when the AI couldn't make a page): the page's sentences shared out over
 * four cells, in order. Plain, but always a complete, rule-keeping comic.
 */
export function splitPage(texts: string[], plan: ComicPagePlan, heroName: string): ComicCellDraft[] {
  const sentences = texts
    .join(" ")
    .split(/(?<=[.!?…]["”]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const groups: string[][] = Array.from({ length: CELLS_PER_PAGE }, () => []);
  sentences.forEach((s, i) => groups[Math.min(CELLS_PER_PAGE - 1, Math.floor((i * CELLS_PER_PAGE) / Math.max(sentences.length, 1)))].push(s));
  const nameWord = new RegExp(`\\b${heroName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return groups.map((g, i) => {
    // What the hero says in the story ("…") goes in a speech bubble; the rest in the story box.
    const said = g.flatMap((s) => [...s.matchAll(QUOTED)].map((m) => m[1].trim())).filter(Boolean);
    // The words around a quote stay in the story box, unless only "Ember said," is left.
    const told = g.flatMap((s) => {
      const rest = s.replace(QUOTED, "").trim();
      return rest === s || rest.split(/\s+/).length >= 3 ? [rest] : [];
    });
    // Never the plan's label as a stand-in: an empty line is better (the picture tells it).
    const caption = said.length && told.length ? told.join(" ") : g.join(" ");
    return {
      caption,
      dialogue: said.length ? cut(said.join(" "), MAX_DIALOGUE_WORDS) : null,
      bubbleType: said.length ? "speech" : "none",
      tempo: plan.tempoAllowed && i === CELLS_PER_PAGE - 1 ? "♪ ♫ ♪" : null,
      sfx: null,
      shot: SHOTS_FOR[PANEL_SHAPES[plan.layout][i]][0],
      // The picture prompt never carries a name.
      scene: cut(caption.replace(nameWord, "the hero"), 40),
    };
  });
}
