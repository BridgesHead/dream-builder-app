// Prompt anonymisation (guide BE-14): what the outbound gate (falClient.ts) does to every
// piece of text before it goes to fal.ai. Pure logic, no database, so it is easy to test.
//
//   1. KNOWN family details (from our database) are replaced:
//        the child's name, the author name  → the name the AI knows the hero by
//        the parent's name                  → "a grown-up"
//        emails, phones, address lines      → removed
//   2. PATTERNS catch what we can't know in advance: emails, phone numbers, links, street
//      addresses ("Villa 12", "P.O. Box 1234") and school names ("Al Noor Primary School").
//   3. The LEAK CHECK looks again: if a known detail is still there, the gate refuses to send.

/** What we know about the family, to keep out of every AI request. */
export interface FamilyDetails {
  /** The child's name as the parent typed it, e.g. "Aisha Rahman". */
  childNames: string[];
  /** The parent's (and other grown-ups') names. */
  grownUpNames: string[];
  /** The book's author name (often the child's own name). */
  authorNames: string[];
  emails: string[];
  phones: string[];
  /** Delivery address lines from orders, e.g. "Villa 12, Street 4". */
  addressLines: string[];
}

export const NO_FAMILY: FamilyDetails = { childNames: [], grownUpNames: [], authorNames: [], emails: [], phones: [], addressLines: [] };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole-word match (letters and digits count as word characters, in any language). */
const wholeWord = (word: string, flags = "giu") => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, flags);

// Small joining words in names that are also everyday words ("bin" → "rubbish bin").
const NAME_PARTICLES = new Set(["al", "el", "bin", "bint", "ibn", "abu", "umm", "de", "da", "di", "du", "van", "von", "la", "le", "the", "and", "mr", "mrs", "ms", "dr"]);

/** "Aisha Al Rahman" → ["Aisha Al Rahman", "Aisha", "Rahman"]: the full name first, then each real name word. */
export function nameParts(names: string[]): string[] {
  const parts = new Set<string>();
  for (const name of names) {
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 2) continue;
    parts.add(clean);
    for (const word of clean.split(/[\s-]+/)) {
      if (word.length >= 3 && !NAME_PARTICLES.has(word.toLowerCase())) parts.add(word);
    }
  }
  // Longest first, so "Aisha Rahman" is replaced before "Aisha".
  return [...parts].sort((a, b) => b.length - a.length);
}

/** Every family name word (child, grown-ups, author), lower case. */
export function familyNameWords(family: FamilyDetails): Set<string> {
  return new Set(nameParts([...family.childNames, ...family.grownUpNames, ...family.authorNames]).map((w) => w.toLowerCase()));
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
/** These digits however they're spaced: "0501234567", "050 123 4567", "050-123-4567". */
const phoneLike = (digits: string, flags = "") => new RegExp(`(?:\\+|00)?${digits.split("").join("[\\s().-]*")}`, flags);

// ---- Patterns -------------------------------------------------------------------------------

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
// 7+ digits, with the usual separators: "+971 50 123 4567", "050-1234567", "(04) 123 4567".
const PHONE = /(?:\+|00)?\d(?:[\s().-]*\d){6,}/g;
const LINK = /\b(?:https?:\/\/|www\.)[^\s"']+|\b[\p{L}\p{N}-]+\.(?:com|ae|net|org|io|co|uk|me|info|app)(?:\/[^\s"']*)?(?![\p{L}\p{N}])/giu;
const STREET_ADDRESS = [
  // "Villa 12", "Building 7", "Flat 3B", "Street 4", "Apartment No. 5"
  /\b(?:villa|flat|apartment|apt|building|bldg|block|tower|street|st|road|rd|avenue|ave|lane|unit|floor|house|office)\.?\s*(?:no\.?\s*|#\s*)?\d+[a-z]?\b/giu,
  // "P.O. Box 1234"
  /\bp\.?\s?o\.?\s?box\s*\d+\b/giu,
  // "12 Al Wasl Road"
  /\b\d+[a-z]?\s+(?:\p{L}+\s+){0,3}(?:street|road|avenue|lane|boulevard)\b/giu,
];
// "Al Noor Primary School", "Dubai International Academy" (capitalised names only: "my school"
// is not a school's name and is kept).
const SCHOOL = /(?:\p{Lu}[\p{L}'’-]*\s+){1,5}(?:Primary\s+School|Secondary\s+School|High\s+School|International\s+School|School|Academy|College|Nursery|Kindergarten|Institute)\b/gu;

/** A neutral stand-in for a grown-up's name. */
export const GROWN_UP = "a grown-up";

/**
 * The text with the family's details taken out. `heroAlias` is the name the AI knows the hero
 * by: the child's own name (and the author name) become that, so the sentence still reads well.
 */
export function anonymise(text: string, family: FamilyDetails, heroAlias: string): string {
  let out = text;
  // 1. Known details.
  for (const email of family.emails) if (email.trim()) out = out.replace(new RegExp(escapeRegex(email.trim()), "gi"), "");
  for (const line of family.addressLines) if (line.trim().length >= 4) out = out.replace(new RegExp(escapeRegex(line.trim()), "gi"), "");
  for (const phone of family.phones) {
    const digits = digitsOf(phone);
    if (digits.length < 7) continue;
    // The same digits however they're spaced: "0501234567" or "050 123 4567".
    out = out.replace(phoneLike(digits, "g"), "");
  }
  // Longest names first, so "Aisha Rahman" goes as a whole before "Rahman" alone. A word the
  // child shares with a grown-up (the family name) is removed as a grown-up's, never turned
  // into the hero.
  const grownUp = new Set(nameParts(family.grownUpNames).map((n) => n.toLowerCase()));
  const swaps = [
    ...nameParts(family.grownUpNames).map((name) => ({ name, to: GROWN_UP })),
    ...nameParts([...family.childNames, ...family.authorNames])
      .filter((n) => !grownUp.has(n.toLowerCase()) && n.toLowerCase() !== heroAlias.toLowerCase())
      .map((name) => ({ name, to: heroAlias })),
  ].sort((a, b) => b.name.length - a.name.length);
  for (const { name, to } of swaps) out = out.replace(wholeWord(name), to);
  // 2. Patterns.
  out = out.replace(EMAIL, "").replace(LINK, "");
  for (const pattern of STREET_ADDRESS) out = out.replace(pattern, "");
  out = out.replace(SCHOOL, "school").replace(PHONE, "");
  // Tidy the gaps left behind.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

/**
 * What identifying is still in `text` (the kinds only, never the details themselves, so the
 * answer is safe to log). Empty = safe to send.
 */
export function findLeaks(text: string, family: FamilyDetails, heroAlias: string): string[] {
  const leaks = new Set<string>();
  const alias = heroAlias.toLowerCase();
  for (const name of nameParts([...family.childNames, ...family.authorNames])) {
    if (name.toLowerCase() !== alias && wholeWord(name, "iu").test(text)) leaks.add("the child's name");
  }
  for (const name of nameParts(family.grownUpNames)) if (wholeWord(name, "iu").test(text)) leaks.add("a grown-up's name");
  const lower = text.toLowerCase();
  for (const email of family.emails) if (email.trim() && lower.includes(email.trim().toLowerCase())) leaks.add("an email address");
  for (const phone of family.phones) {
    const digits = digitsOf(phone);
    if (digits.length >= 7 && phoneLike(digits).test(text)) leaks.add("a phone number");
  }
  if (new RegExp(EMAIL.source, "iu").test(text)) leaks.add("an email address");
  if (new RegExp(PHONE.source).test(text)) leaks.add("a phone number");
  if (new RegExp(LINK.source, "iu").test(text)) leaks.add("a link");
  return [...leaks];
}
