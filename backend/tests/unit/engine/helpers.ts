// Shared helpers for the engine tests.
import { buildContext, runEngine, type DraftPanel, type EngineResult, type RuleId, type StoryAnswers } from "../../../src/engine/index.js";
import { copyOf, EMBER_ANSWERS, EMBER_THREE_ACT } from "../../fixtures/engine/samples.js";

/** Runs the engine on a copy of the good sample, after `breakIt` changed one thing. */
export function runOn(breakIt: (draft: DraftPanel[]) => void = () => undefined, answers: StoryAnswers = EMBER_ANSWERS, base = EMBER_THREE_ACT): EngineResult {
  const draft = copyOf(base);
  breakIt(draft);
  return runEngine(draft, buildContext(answers));
}

export const rulesIn = (findings: { rule: RuleId }[]) => [...new Set(findings.map((f) => f.rule))];

/** Re-runs the engine on what it produced: a repaired story must now pass cleanly. */
export function rerun(result: EngineResult, answers: StoryAnswers = EMBER_ANSWERS, base = EMBER_THREE_ACT): EngineResult {
  // Keep the beats of the brave-move panels (the engine reads beats there), take the text elsewhere.
  const draft = result.panels.map((p) => {
    const original = base.find((b) => b.number === p.number);
    return original?.beats ? { number: p.number, beats: original.beats } : { number: p.number, text: p.text };
  });
  return runEngine(draft, buildContext(answers));
}

export const textOf = (result: EngineResult, number: number) => result.panels.find((p) => p.number === number)!.text;
