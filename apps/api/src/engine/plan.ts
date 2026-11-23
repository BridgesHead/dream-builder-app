import type { StoryPath } from "../types/story.js";

// The panel plans (guide BE-09, PRD F4). A panel is one page of the story: some text and one
// picture. Each panel has a job ("role") in the hero's journey:
//
//   Act 1  1 Identity Anchor · 2 Internal Gift · 3 The Call · 4 First Shadow · 5 First Pivot
//          6 The Heavy Heart · 7 Rest & Restoration
//   Act 2  8 Second Shadow · 9 Second Brave Move · 10 Persistence · 11 Plateau Triumph
//   Act 3  12 Third Shadow / Deepest Pause · 13 Final Pivot · 14 Grand Finale · 15 Practice Anchor
//
// three_act uses all 15. two_act has 12 (the guide's count): panels 1–10, then the Grand Finale
// and the Practice Anchor. Decided by Anas: a two-act story skips the third challenge
// (12 Third Shadow, 13 Final Pivot) and also Plateau Triumph (11), which would repeat the
// Grand Finale right after it. Sami Bhai to check it matches the prototype.
// It's only TWO_ACT_ROLES below, so changing it is one line.

export type PanelRole =
  | "identity"
  | "gift"
  | "call"
  | "shadow1"
  | "pivot1"
  | "heavyHeart"
  | "rest"
  | "shadow2"
  | "pivot2"
  | "persistence"
  | "plateau"
  | "shadow3"
  | "pivot3"
  | "finale"
  | "anchor";

const LABELS: Record<PanelRole, string> = {
  identity: "Identity Anchor",
  gift: "Internal Gift",
  call: "The Call",
  shadow1: "First Shadow",
  pivot1: "First Pivot",
  heavyHeart: "The Heavy Heart",
  rest: "Rest & Restoration",
  shadow2: "Second Shadow",
  pivot2: "Second Brave Move",
  persistence: "Persistence",
  plateau: "Plateau Triumph",
  shadow3: "Third Shadow / Deepest Pause",
  pivot3: "Final Pivot",
  finale: "Grand Finale",
  anchor: "Practice Anchor",
};

const ACT: Record<PanelRole, 1 | 2 | 3> = {
  identity: 1, gift: 1, call: 1, shadow1: 1, pivot1: 1, heavyHeart: 1, rest: 1,
  shadow2: 2, pivot2: 2, persistence: 2, plateau: 2,
  shadow3: 3, pivot3: 3, finale: 3, anchor: 3,
};

const THREE_ACT_ROLES: PanelRole[] = [
  "identity", "gift", "call", "shadow1", "pivot1", "heavyHeart", "rest",
  "shadow2", "pivot2", "persistence", "plateau",
  "shadow3", "pivot3", "finale", "anchor",
];
// Act 1, Act 2 up to Persistence, then the two closing panels (no Plateau Triumph, no Act 3).
const TWO_ACT_ROLES: PanelRole[] = [
  "identity", "gift", "call", "shadow1", "pivot1", "heavyHeart", "rest",
  "shadow2", "pivot2", "persistence",
  "finale", "anchor",
];

// The 8-Beat Arc (PRD F4): the brave-move panels are written as eight moments, in this order.
// Decision 2A: Panels 5 AND 9 (the guide says "5 and 8"; Panel 9 is the second brave move,
// where heroWords2 goes, so we read it as 9). ⚠️ Waiting for Sami Bhai to confirm.
export const BEAT_NAMES = ["Trigger", "Metaphor", "Signal", "Try", "Stumble", "Re-center", "Try Again", "Partial Shift"] as const;
export const BEAT_ROLES: PanelRole[] = ["pivot1", "pivot2"];
// Index of the beats the rules care about (0-based).
export const BEAT = { signal: 2, try: 3, partialShift: 7 } as const;

export interface PanelPlan {
  number: number;
  role: PanelRole;
  label: string;
  act: 1 | 2 | 3;
  /** Written as the eight beats. */
  beats: boolean;
}

export function planFor(path: StoryPath): PanelPlan[] {
  const roles = path === "three_act" ? THREE_ACT_ROLES : TWO_ACT_ROLES;
  return roles.map((role, i) => ({ number: i + 1, role, label: LABELS[role], act: ACT[role], beats: BEAT_ROLES.includes(role) }));
}

/** The panel with this job in the plan, or undefined (e.g. no "shadow3" in a two-act story). */
export function panelFor(plan: PanelPlan[], role: PanelRole): PanelPlan | undefined {
  return plan.find((p) => p.role === role);
}
