import { buildContext, rewriteRequests, runEngine, RULES, type DraftPanel, type Finding } from "../engine/index.js";
import type { AiProvider, StoryForAi } from "./providers.js";

// Writing the story text (guide BE-09, BE-10): the AI's draft goes through the story engine.
//
//   AI draft → engine → repairs (logged) → panels to rewrite?
//                         └─ yes → the AI rewrites ONLY those panels → engine again
//                                  (at most MAX_REWRITE_ROUNDS times, decision 6A)
//   still broken → StoryRulesError: this try fails, and the BE-07 retry starts fresh
//
// Every problem found is returned as a violation for the job record (Book Progress Detail).

export const MAX_REWRITE_ROUNDS = 2;

export interface Violation {
  rule: string;
  message: string;
  panelNumber: number | null;
  fixedBy: "repaired" | "rewritten" | "failed";
}

export class StoryRulesError extends Error {
  constructor(
    message: string,
    readonly violations: Violation[],
  ) {
    super(message);
    this.name = "StoryRulesError";
  }
}

const key = (f: Finding) => `${f.rule}|${f.panelNumber}|${f.message}`;
// The same problem in the same panel, even if the wording changed between rounds.
const spot = (f: Finding) => `${f.rule}|${f.panelNumber}`;
const toViolation = (f: Finding, fixedBy: Violation["fixedBy"]): Violation => ({
  rule: RULES[f.rule],
  message: f.message,
  panelNumber: f.panelNumber,
  fixedBy,
});

export async function writeStoryText(provider: AiProvider, story: StoryForAi) {
  const ctx = buildContext(story);
  const first = await provider.storyText(story);
  let draft: DraftPanel[] = first.value;
  const repaired = new Map<string, Finding>();
  const sentBack = new Map<string, Finding>();

  for (let round = 0; ; round += 1) {
    const result = runEngine(draft, ctx);
    for (const f of result.repaired) repaired.set(key(f), f);

    const violations = (stillBroken: Finding[]) => [
      ...[...repaired.values()].map((f) => toViolation(f, "repaired")),
      ...[...sentBack.values()].filter((f) => !stillBroken.some((b) => spot(b) === spot(f))).map((f) => toViolation(f, "rewritten")),
      ...stillBroken.map((f) => toViolation(f, "failed")),
    ];

    if (result.fatal) throw new StoryRulesError(result.fatal, violations([]));
    if (result.rewrite.length === 0) {
      const { provider, aiModel, fallback, fallbackUsed, promptVersion } = first;
      return { provider, aiModel, fallback, fallbackUsed, promptVersion, panels: result.panels, violations: violations([]) };
    }
    if (round === MAX_REWRITE_ROUNDS) {
      const reasons = result.rewrite.map((f) => `${f.rule} (panel ${f.panelNumber}): ${f.message}`).join("; ");
      throw new StoryRulesError(`Story rules still broken after ${MAX_REWRITE_ROUNDS} rewrites: ${reasons}`, violations(result.rewrite));
    }

    // Ask the AI to rewrite only the panels the engine sent back.
    for (const f of result.rewrite) sentBack.set(spot(f), f);
    const fresh = (await provider.rewritePanels(story, rewriteRequests(result.rewrite), draft)).value;
    draft = [...draft.filter((p) => !fresh.some((n) => n.number === p.number)), ...fresh].sort((x, y) => x.number - y.number);
  }
}
