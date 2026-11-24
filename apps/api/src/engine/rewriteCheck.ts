import { BANNED_RESOLUTION_WORDS, CLINICAL_WORDS, MAGIC_WORDS } from "./tables.js";
import { comparable, sentences } from "./text.js";

// The checks on a sentence from the Creator-mode rewriter (guide BE-12). Pure logic, no HTTP
// or database, like the rest of the engine.
//
//   one sentence only        "Ember ran. She smiled." is two: refused
//   within the word limit    REWRITE_MAX_WORDS (25 until Sami Bhai confirms the prototype's)
//   the story's tone         no clinical words, no magic fixes, no "the obstacle vanished"
//                            (the same word lists the story engine uses, BE-09)
//   actually different       the same sentence back is no help

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// A fresh copy without the "g" flag, so .test() has no memory between calls.
const once = (pattern: RegExp) => new RegExp(pattern.source, pattern.flags.replace("g", ""));
const TONE_RULES: { pattern: RegExp; problem: string }[] = [
  ...CLINICAL_WORDS.map(({ pattern }) => ({ pattern: once(pattern), problem: "uses a clinical word" })),
  { pattern: once(MAGIC_WORDS), problem: "uses magic to fix the problem" },
  { pattern: once(BANNED_RESOLUTION_WORDS), problem: "makes the obstacle disappear" },
];

/** Tidies the AI's answer: one line, no wrapping quotes, no "Here is…" chatter. */
export function cleanRewrite(raw: string): string {
  return raw
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^(?:here(?:'s| is)[^:]*:\s*)/i, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}

/** What's wrong with the rewrite (empty = it's fine). */
export function rewriteProblems(rewrite: string, original: string, maxWords: number): string[] {
  const problems: string[] = [];
  if (!rewrite) return ["is empty"];
  if (sentences(rewrite).length !== 1) problems.push("is not exactly one sentence");
  const words = wordCount(rewrite);
  if (words > maxWords) problems.push(`has ${words} words (at most ${maxWords})`);
  for (const rule of TONE_RULES) {
    // A word the child used themselves is theirs to keep.
    if (rule.pattern.test(rewrite) && !rule.pattern.test(original)) problems.push(rule.problem);
  }
  if (comparable(rewrite) === comparable(original)) problems.push("is the same as the original");
  return [...new Set(problems)];
}
