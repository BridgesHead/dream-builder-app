// Small text helpers for the engine. Plain functions, no database.

/** Curly quotes → straight ones, so “Hi” and "Hi" compare the same. */
export function straightQuotes(s: string): string {
  return s.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
}

/** The child's words without any quotes they typed around them, e.g. “I can.” → I can. */
export function unquote(s: string): string {
  return straightQuotes(s).trim().replace(/^["']+|["']+$/g, "").trim();
}

/** For comparing: straight quotes, single spaces, lower case, no end punctuation. */
export function comparable(s: string): string {
  return straightQuotes(s).replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "").toLowerCase();
}

/** Does `text` contain the child's `words` word for word (ignoring case and end punctuation)? */
export function containsVerbatim(text: string, words: string): boolean {
  const target = comparable(words);
  return target.length > 0 && comparable(text).includes(target);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Runs `fn` on every part of `text` EXCEPT the child's own words, which are never changed
 * (PRD §6 rule 4: "never paraphrased").
 */
export function outsideChildWords(text: string, childWords: string[], fn: (part: string) => string): string {
  const words = childWords.filter((w) => w.length > 0);
  if (words.length === 0) return fn(text);
  const split = new RegExp(`(${words.map(escapeRegex).join("|")})`, "gi");
  return text
    .split(split)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

/** The text with the child's own words taken out, for checks that must not judge them. */
export function withoutChildWords(text: string, childWords: string[]): string {
  const words = childWords.filter((w) => w.length > 0);
  if (words.length === 0) return text;
  return text.replace(new RegExp(words.map(escapeRegex).join("|"), "gi"), " ");
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STOP = new Set([
  "the", "and", "that", "with", "this", "from", "they", "were", "have", "into", "then", "there", "their", "them", "when",
  "what", "your", "will", "just", "again", "once", "more", "felt", "said", "very", "over", "onto",
]);

/** The meaningful words of a sentence (for "is this a near-copy?"). */
export function contentWords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/** How alike two sentences are: 0 = nothing shared, 1 = the same words. */
export function overlap(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

/** Joins sentences with single spaces. */
export function joinText(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
