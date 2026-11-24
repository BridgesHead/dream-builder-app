import type { StoryContext } from "./context.js";
import { CHECKS } from "./rules/checks.js";
import {
  repairActThreeVoice,
  repairBraveStep,
  repairClinicalWords,
  repairInnerVoice,
  repairOpenAgency,
  repairPracticeTag,
  repairPronounCase,
  repairStrategyLabel,
} from "./rules/repairs.js";
import { joinText, straightQuotes } from "./text.js";
import { finding, type DraftPanel, type EngineResult, type Finding, type WorkPanel } from "./types.js";

// THE story engine (guide BE-09). No HTTP, no database: the AI's draft goes in, and out come
// the panels to save, what was repaired, and which panels need rewriting.
//
//   1. lay the draft over the panel plan  (missing / empty panels → rewrite, defect 5;
//                                           extra panels → fatal: never cut or padded)
//   2. brave-move panels: the eight beats (missing / fused beats → rewrite, defect 4)
//   3. repairs   small certain fixes, logged       (rules/repairs.ts)
//   4. checks    everything else → rewrite list     (rules/checks.ts)

export * from "./types.js";
export { buildContext, type StoryAnswers, type StoryContext } from "./context.js";
export { planFor, BEAT_NAMES } from "./plan.js";
export { cleanRewrite, rewriteProblems, wordCount } from "./rewriteCheck.js";

export function runEngine(draft: DraftPanel[], ctx: StoryContext): EngineResult {
  const repaired: Finding[] = [];
  const rewrite: Finding[] = [];
  const plan = ctx.plan;

  // 1. Exactly the planned panels: never padded, never cut (guide BE-10).
  const extra = draft.filter((d) => !plan.some((p) => p.number === d.number));
  const numbers = draft.map((d) => d.number);
  if (extra.length > 0 || new Set(numbers).size !== numbers.length) {
    return { panels: [], repaired, rewrite, fatal: `Expected panels 1–${plan.length}, got ${numbers.join(", ")}` };
  }

  const panels: WorkPanel[] = [];
  for (const p of plan) {
    const d = draft.find((x) => x.number === p.number);
    const hasContent = !!d && (!!d.text?.trim() || (Array.isArray(d.beats) && d.beats.some((b) => String(b ?? "").trim())));
    // Defect 5: a skipped or blank panel (e.g. Panel 6, The Heavy Heart).
    if (!d || !hasContent) {
      rewrite.push(finding("PANELS", p.number, `Panel ${p.number} (${p.label}) is ${d ? "empty" : "missing"}`));
      panels.push({ number: p.number, plan: p, text: "", beats: null });
      continue;
    }
    // Brave-move panels come as eight beats; a plain text instead is caught by checkBeats.
    const beats = p.beats && Array.isArray(d.beats) ? d.beats.map((b) => straightQuotes(String(b ?? ""))) : null;
    const text = beats ? joinText(beats) : straightQuotes(d.text ?? "").trim();
    panels.push({ number: p.number, plan: p, text, beats });
  }

  // 2 + 3. Repairs. Beat repairs first, then the beats become the panel's text.
  for (const panel of panels) {
    if (panel.beats && panel.beats.length === 8) {
      repaired.push(...repairOpenAgency(panel, ctx));
      panel.text = joinText(panel.beats);
    }
    if (!panel.text) continue;
    repaired.push(
      ...repairClinicalWords(panel, ctx),
      ...repairInnerVoice(panel, ctx),
      ...repairPronounCase(panel, ctx),
      ...(panel.plan.role === "finale" ? repairStrategyLabel(panel, ctx) : []),
      ...repairActThreeVoice(panel, ctx),
      ...repairBraveStep(panel, ctx),
      ...repairPracticeTag(panel),
    );
  }

  // 4. Checks on the repaired panels (missing panels were already sent for a rewrite).
  const present = panels.filter((p) => p.text || p.beats);
  for (const check of CHECKS) rewrite.push(...check(present, ctx));

  return { panels: panels.map((p) => ({ number: p.number, text: p.text })), repaired, rewrite, fatal: null };
}

/** The rewrite list grouped per panel: what the AI is asked to fix. */
export function rewriteRequests(rewrite: Finding[]): { panelNumber: number; reasons: string[] }[] {
  const byPanel = new Map<number, string[]>();
  for (const f of rewrite) {
    if (f.panelNumber === null) continue;
    byPanel.set(f.panelNumber, [...(byPanel.get(f.panelNumber) ?? []), f.message]);
  }
  return [...byPanel].map(([panelNumber, reasons]) => ({ panelNumber, reasons }));
}
