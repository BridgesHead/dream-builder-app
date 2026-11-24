// The engine's word tables (guide BE-09).
//
// ⚠️ STARTER TABLES (decision 3A). The prototype's full tables (its "Psychological Playbook"
// and dream-world table, in its lib/content) haven't arrived yet. These are built from the
// PRD's examples plus common cases. When the prototype's tables arrive, replace the lists
// here; the rules that use them don't change.

// ---- Heroes ----------------------------------------------------------------------------

export type HeroType = "fox" | "robot" | "knight";

export const HERO_DEFAULT_NAMES: Record<HeroType, string> = { fox: "Ember", robot: "Sparky", knight: "Brave" };

/**
 * Beat 3 of the 8-Beat Arc: the body signal, different for each hero (PRD F4).
 * `pattern` finds it in text (also in another hero's story: the bleed-guard, defect 3).
 */
export const BODY_SIGNALS: Record<HeroType, { phrase: string; pattern: RegExp }> = {
  robot: { phrase: "gears grind", pattern: /\bgears?\s+(?:grind|ground|grinding|grinds)\b/i },
  fox: { phrase: "tail bristles", pattern: /\btail\s+(?:bristle|bristled|bristles|bristling)\b/i },
  knight: { phrase: "shield arm trembles", pattern: /\bshield[\s-]arm\s+(?:tremble|trembled|trembles|trembling)\b/i },
};

/** Body parts only one kind of hero has, e.g. "Ember's gears" is a mix-up (defect 3). */
export const HERO_PARTS: Record<HeroType, string[]> = {
  robot: ["gears", "circuits", "bolts", "porthole eye", "brass torso"],
  fox: ["tail", "paws", "whiskers", "fur"],
  knight: ["shield arm", "armour", "armor", "helmet", "visor"],
};

// ---- The child's choices, as words (copied from the frontend's src/data/content.ts) ------

export const TOOL_WORDS: Record<string, string> = {
  wheelchair: "wheelchair",
  headphones: "headphones",
  "fidget-toy": "fidget toy",
  "white-cane": "white cane",
  "hearing-aid": "hearing aid",
  glasses: "glasses",
};

export const STRENGTH_WORDS: Record<string, string> = {
  "big-curiosity": "big curiosity",
  "kind-heart": "kind heart",
  "clever-inventions": "clever inventions",
  "super-focus": "super focus",
  "creative-vision": "creative vision",
  "brave-courage": "brave courage",
  curious: "curiosity",
  empathetic: "empathy",
  inventive: "inventiveness",
  focused: "focus",
  imaginative: "imagination",
  resilient: "resilience",
};

export const OBSTACLE_WORDS: Record<string, string> = {
  "grumpy-giant": "the Grumpy Giant",
  "roaring-fire": "the Roaring Fire",
  "humming-mist": "the Humming Mist",
  "messy-blueprint": "the Messy Blueprint",
  "mean-whispers": "the Mean Whispers",
  "thundering-cloud": "the Thundering Cloud",
  "glass-wall": "the Glass Wall",
  "mean-shadow": "the Mean Shadow",
};

export const BRAVE_MOVE_WORDS: Record<string, string> = {
  "shrink-the-giant": "breaking the big task into three small pieces",
  "find-first-step": "finding one tiny first step",
  "ask-for-help": "asking a friend for a hand",
  "deep-breaths": "taking three slow belly breaths",
  "lead-the-way": "leading the way with calm confidence",
  "try-something-new": "trying something new and unexpected",
  "stand-my-ground": "standing firm with quiet patience",
  "calm-honesty": "speaking with calm, steady honesty",
};

// ---- Rule 1: no clinical labels in the story (PRD §6) -----------------------------------
// A clinical word and its poetic name. `poetic: null` = no safe swap, so the panel is rewritten.

export const CLINICAL_WORDS: { pattern: RegExp; poetic: string | null }[] = [
  { pattern: /\banxiety\b/gi, poetic: "the Humming Mist" },
  { pattern: /\brejection\b/gi, poetic: "the Cold Barrier" },
  { pattern: /\bdepression\b/gi, poetic: "the Heavy Grey" },
  { pattern: /\btrauma\b/gi, poetic: "the Old Storm" },
  { pattern: /\bpanic attacks?\b/gi, poetic: "the Racing Drum" },
  { pattern: /\bphobias?\b/gi, poetic: null },
  { pattern: /\bdisorders?\b/gi, poetic: null },
  { pattern: /\b(?:ADHD|OCD|PTSD)\b/g, poetic: null },
  { pattern: /\bdiagnos(?:is|ed|e)\b/gi, poetic: null },
  { pattern: /\bsymptoms?\b/gi, poetic: null },
  { pattern: /\btherap(?:y|ist|ies)\b/gi, poetic: null },
  { pattern: /\bmental health\b/gi, poetic: null },
];

// ---- Rule 2: every panel set in the dream world, and the Core Noun -----------------------
// The first row whose `match` fits the dream is used. `noun` is the Core Noun when the dream
// is an action ("fly to the moon" → "astronaut"); `words` are dream-world words the key
// panels should use.

export interface DreamWorld {
  name: string;
  match: RegExp;
  noun: string;
  words: string[];
}

export const DREAM_WORLDS: DreamWorld[] = [
  { name: "space", match: /\b(?:astronaut|space|moon|rocket|stars?|planets?|galaxy)\b/i, noun: "astronaut", words: ["stars", "rocket", "moon", "planet", "orbit", "observation deck", "space"] },
  { name: "football", match: /\b(?:soccer|football(?:er)?|goal(?:keeper)?)\b/i, noun: "footballer", words: ["pitch", "goal", "crowd", "stadium", "ball", "match"] },
  { name: "kitchen", match: /\b(?:chef|cook(?:ing)?|bak(?:e|er|ing)|kitchen)\b/i, noun: "chef", words: ["kitchen", "oven", "pan", "recipe", "spoon", "apron"] },
  { name: "animals", match: /\b(?:vet|veterinarian|animals?|pets?|zoo)\b/i, noun: "vet", words: ["clinic", "animals", "puppy", "kitten", "stethoscope", "pet"] },
  { name: "hospital", match: /\b(?:doctor|nurse|hospital|surgeon)\b/i, noun: "doctor", words: ["hospital", "stethoscope", "patients", "clinic", "ward"] },
  { name: "stage", match: /\b(?:sing(?:er|ing)?|songs?|pop ?star)\b/i, noun: "singer", words: ["stage", "song", "microphone", "melody", "audience"] },
  { name: "music", match: /\b(?:music(?:ian)?|band|guitar|piano|drums?|violin)\b/i, noun: "musician", words: ["music", "melody", "stage", "notes", "instrument"] },
  { name: "studio", match: /\b(?:artist|draw(?:ing)?|paint(?:er|ing)?|art)\b/i, noun: "artist", words: ["canvas", "paint", "brush", "colours", "colors", "sketch", "gallery"] },
  { name: "dance", match: /\b(?:danc(?:e|er|ing)|ballet|ballerina)\b/i, noun: "dancer", words: ["stage", "music", "steps", "spin", "studio", "ballet"] },
  { name: "workshop", match: /\b(?:build(?:er)?|engineer|invent(?:or)?|robots?|mechanic)\b/i, noun: "inventor", words: ["workshop", "blueprint", "machine", "invention", "tools"] },
  { name: "library", match: /\b(?:writ(?:e|er|ing)|author|books?|stor(?:y|ies)|poet)\b/i, noun: "writer", words: ["pages", "ink", "notebook", "library", "words", "story"] },
  { name: "classroom", match: /\b(?:teach(?:er|ing)?|school)\b/i, noun: "teacher", words: ["classroom", "lesson", "students", "school", "chalk"] },
  { name: "sky", match: /\b(?:pilot|fly(?:ing)?|planes?|aeroplanes?|airplanes?)\b/i, noun: "pilot", words: ["sky", "clouds", "cockpit", "runway", "plane", "wings"] },
];

/** Used when the dream matches no row (decision 4A). */
export const FALLBACK_CORE_NOUN = "dreamer";

// ---- Rule 3: success is earned, not magic ------------------------------------------------
export const MAGIC_WORDS = /\b(?:magic(?:al|ally)?|spells?|poof|abracadabra|miracles?|magic wand|wands?|suddenly)\b/gi;

// ---- Partial Shift: the obstacle never disappears (PRD F4) -------------------------------
export const BANNED_RESOLUTION_WORDS = /\b(?:shattered|vanished|dissolved|fixed|solved|gone)\b/gi;

// ---- Two acts: no third challenge -------------------------------------------------------
export const THIRD_ACT_PHRASES = /\b(?:third (?:challenge|obstacle|shadow)|one (?:last|final) (?:challenge|obstacle|shadow)|greatest challenge)\b/gi;

// ---- Defect 6: strategy labels in the Grand Finale ---------------------------------------
// "One Brave Sentence strategy" → "brave words"; "<any title> strategy" → the title alone.
export const ONE_BRAVE_SENTENCE = /\b(?:the\s+)?one brave sentence(?:\s+strateg(?:y|ies))?\b/gi;
export const STRATEGY_WORD = /\s+strateg(?:y|ies)\b/gi;

// ---- Defect 7: pronoun case ---------------------------------------------------------------
// After these words a pronoun is an OBJECT ("leaving her", not "leaving she").
export const OBJECT_POSITION_WORDS = [
  "to", "for", "with", "at", "beside", "behind", "toward", "towards", "about", "from", "around", "near", "without",
  "leaving", "left", "helped", "helping", "help", "told", "telling", "gave", "giving", "let", "showed", "showing",
  "watched", "called", "asked", "thanked", "hugged", "followed", "carried", "lifted", "reminded", "cheered", "greeted",
];
// …unless a verb follows, so it's really the subject of a new clause ("she saw he was right").
export const SUBJECT_FOLLOWERS = [
  "was", "were", "is", "had", "has", "could", "would", "should", "will", "can", "did", "might", "felt", "knew",
  "thought", "said", "wanted", "needed", "took", "tried", "looked", "smiled", "kept", "made",
];

// ---- Defect 9: garbled compounds ----------------------------------------------------------
// "world-future": two big abstract words glued with a hyphen. "Singer" mid-sentence: a role
// word with a capital letter where it shouldn't have one.
export const ABSTRACT_WORDS = ["world", "future", "dream", "heart", "star", "hope", "soul", "mind", "time", "light", "wish", "spirit", "destiny"];
export const ROLE_WORDS = [
  "singer", "dancer", "doctor", "vet", "chef", "astronaut", "artist", "builder", "explorer", "player", "footballer", "pilot",
  "teacher", "writer", "inventor", "musician", "scientist", "engineer", "nurse", "dreamer", "hero",
];
