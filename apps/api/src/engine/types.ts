import type { PanelPlan } from "./plan.js";

// The names of the rules the engine checks. R1–R10 are the PRD's 10 Narrative Integrity
// Rules (§6); D3–D9 are the known defects (PRD §7, guide BE-09).
export const RULES = {
  R1: "R1 No clinical labels",
  R2: "R2 Aspiration grounding",
  R3: "R3 Earned Success Bridge",
  R4: "R4 Authentic child voice",
  R5: "R5 Inner voice format",
  R6: "R6 Character consistency",
  R7: "R7 Open agency (One Brave Sentence)",
  R8: "R8 Brave move parity",
  R9: "R9 Practice Anchor closure",
  R10: "R10 Brave-Step Mandate",
  BEATS: "8-Beat Arc",
  PARTIAL_SHIFT: "Partial Shift (banned words)",
  PANELS: "Panel plan (D5)",
  TWO_ACT: "Two-act story has no Act 3",
  D3: "D3 Bleed-guard",
  D6: "D6 Strategy label in the Grand Finale",
  D7: "D7 Pronoun case",
  D9: "D9 Vocabulary garble",
} as const;
export type RuleId = keyof typeof RULES;

/** One problem the engine found. */
export interface Finding {
  rule: RuleId;
  panelNumber: number | null;
  message: string;
}

/** A panel as the AI sent it: text, or (for the brave-move panels) the eight beats. */
export interface DraftPanel {
  number: number;
  text?: string | null;
  beats?: string[] | null;
}

/** A panel while the engine works on it. */
export interface WorkPanel {
  number: number;
  plan: PanelPlan;
  text: string;
  beats: string[] | null;
}

export interface EngineResult {
  /** The panels to save (after repairs). */
  panels: { number: number; text: string }[];
  /** Problems the engine fixed itself. */
  repaired: Finding[];
  /** Problems that need the AI to rewrite these panels. */
  rewrite: Finding[];
  /** A problem no rewrite can fix (e.g. too many panels): the whole try fails. */
  fatal: string | null;
}

export const finding = (rule: RuleId, panelNumber: number | null, message: string): Finding => ({ rule, panelNumber, message });
