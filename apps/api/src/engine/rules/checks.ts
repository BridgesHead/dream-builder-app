import type { StoryContext } from "../context.js";
import { BEAT, BEAT_NAMES, type PanelRole } from "../plan.js";
import {
  ABSTRACT_WORDS,
  BANNED_RESOLUTION_WORDS,
  BODY_SIGNALS,
  CLINICAL_WORDS,
  HERO_PARTS,
  MAGIC_WORDS,
  ROLE_WORDS,
  THIRD_ACT_PHRASES,
} from "../tables.js";
import { comparable, containsVerbatim, escapeRegex, joinText, overlap, sentences, withoutChildWords } from "../text.js";
import { finding, type Finding, type WorkPanel } from "../types.js";

// CHECKS: problems the engine can't fix safely by itself, so it asks the AI to rewrite that
// panel (decision 3A). Each check returns what it found; an empty list means "all good".
// The child's own words are left out of every check: they are never judged or changed.

type Check = (panels: WorkPanel[], ctx: StoryContext) => Finding[];

const byRole = (panels: WorkPanel[], ...roles: PanelRole[]) => panels.filter((p) => roles.includes(p.plan.role));
const clean = (text: string, ctx: StoryContext) => withoutChildWords(text, ctx.childWords);
const matches = (text: string, pattern: RegExp) => [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))].map((m) => m[0]);

// 8-Beat Arc + defect 4: the brave-move panels have all eight beats, none empty, none fused,
// and beat 3 is THIS hero's body signal.
export const checkBeats: Check = (panels, ctx) => {
  const found: Finding[] = [];
  for (const panel of panels.filter((p) => p.plan.beats)) {
    const beats = panel.beats;
    if (!beats) {
      found.push(finding("BEATS", panel.number, "Must be written as the eight beats"));
      continue;
    }
    if (beats.length !== BEAT_NAMES.length) {
      found.push(finding("BEATS", panel.number, `Has ${beats.length} beats; it needs all ${BEAT_NAMES.length}, in order`));
      continue;
    }
    const empty = BEAT_NAMES.filter((_, i) => !beats[i]?.trim());
    if (empty.length > 0) found.push(finding("BEATS", panel.number, `Missing beats: ${empty.join(", ")}`));
    // Two beats that say the same thing = the AI fused them (e.g. Re-center and Try Again).
    for (let i = 1; i < beats.length; i += 1) {
      if (beats[i].trim() && comparable(beats[i]) === comparable(beats[i - 1])) {
        found.push(finding("BEATS", panel.number, `Beats "${BEAT_NAMES[i - 1]}" and "${BEAT_NAMES[i]}" are the same`));
      }
    }
    if (beats[BEAT.signal]?.trim() && !BODY_SIGNALS[ctx.heroType].pattern.test(beats[BEAT.signal])) {
      found.push(finding("BEATS", panel.number, `The Signal beat must show ${ctx.heroName}'s body signal (${BODY_SIGNALS[ctx.heroType].phrase})`));
    }
  }
  return found;
};

// Partial Shift: the obstacle never disappears. Banned words in the resolution beats:
// beat 8 of the brave-move panels, the Final Pivot and the Grand Finale.
export const checkPartialShift: Check = (panels, ctx) => {
  const found: Finding[] = [];
  for (const panel of panels) {
    const resolutionPanel = panel.plan.role === "pivot3" || panel.plan.role === "finale";
    const text = panel.plan.beats ? (panel.beats?.[BEAT.partialShift] ?? "") : resolutionPanel ? panel.text : "";
    const banned = matches(clean(text, ctx), BANNED_RESOLUTION_WORDS);
    if (banned.length > 0) {
      found.push(finding("PARTIAL_SHIFT", panel.number, `The obstacle must not disappear; banned words: ${[...new Set(banned)].join(", ")}`));
    }
  }
  return found;
};

// R1: clinical words with no safe poetic swap (the repairs swapped the others).
export const checkClinicalWords: Check = (panels, ctx) =>
  panels.flatMap((panel) => {
    const words = CLINICAL_WORDS.flatMap(({ pattern }) => matches(clean(panel.text, ctx), pattern));
    return words.length ? [finding("R1", panel.number, `Clinical words in the story: ${[...new Set(words)].join(", ")}`)] : [];
  });

// R2: the key panels are set in the child's dream world (only when the dream matches the table).
export const checkDreamWorld: Check = (panels, ctx) => {
  const world = ctx.world;
  if (!world) return [];
  return byRole(panels, "call", "plateau", "finale").flatMap((panel) => {
    const text = clean(panel.text, ctx).toLowerCase();
    return world.words.some((w) => text.includes(w.toLowerCase()))
      ? []
      : [finding("R2", panel.number, `Must be set in the dream world (${world.name}: e.g. ${world.words.slice(0, 3).join(", ")})`)];
  });
};

// R3: the triumph is earned through effort, never magic.
export const checkEarnedSuccess: Check = (panels, ctx) =>
  byRole(panels, "plateau", "pivot3", "finale").flatMap((panel) => {
    const words = matches(clean(panel.text, ctx), MAGIC_WORDS);
    return words.length ? [finding("R3", panel.number, `Success must be earned, not magic: ${[...new Set(words)].join(", ")}`)] : [];
  });

// R4: the Final Pivot echoes the child's Act 3 words in prose only, never word for word.
// The hero's own name doesn't count as copying (a child may type just the name, e.g. "Pip").
export const checkFinalPivotEcho: Check = (panels, ctx) => {
  const words = ctx.heroWords[3];
  if (!words) return [];
  const name = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(ctx.heroName)}(?![\\p{L}\\p{N}])`, "giu");
  const withoutName = (text: string) => (ctx.heroName ? text.replace(name, " ") : text);
  return byRole(panels, "pivot3")
    .filter((p) => containsVerbatim(withoutName(p.text), withoutName(words)))
    .map((p) => finding("R4", p.number, "Must echo the child's Act 3 words in its own words, not repeat them"));
};

// R6 + defect 3 (bleed-guard): the same hero all the way through: their name, their tools,
// and nothing from another hero (another default name, body signal or body part).
export const checkCharacter: Check = (panels, ctx) => {
  const found: Finding[] = [];
  for (const panel of panels) {
    const text = clean(panel.text, ctx);
    for (const name of ctx.otherHeroNames) {
      if (new RegExp(`\\b${escapeRegex(name)}\\b`).test(text)) found.push(finding("D3", panel.number, `Another hero's name appears: ${name}`));
    }
    for (const other of ctx.otherHeroTypes) {
      if (BODY_SIGNALS[other].pattern.test(text)) {
        found.push(finding("D3", panel.number, `Another hero's body signal appears: ${BODY_SIGNALS[other].phrase}`));
      }
      for (const part of HERO_PARTS[other]) {
        if (new RegExp(`\\b${escapeRegex(ctx.heroName)}'s\\s+${escapeRegex(part)}\\b`, "i").test(text)) {
          found.push(finding("D3", panel.number, `${ctx.heroName} is given another hero's ${part}`));
        }
      }
    }
  }
  for (const panel of byRole(panels, "identity", "finale")) {
    if (!panel.text.includes(ctx.heroName)) found.push(finding("R6", panel.number, `Must name the hero, ${ctx.heroName}`));
  }
  const story = panels.map((p) => p.text).join(" ").toLowerCase();
  const missing = ctx.toolWords.filter((tool) => !story.includes(tool));
  const gift = byRole(panels, "gift")[0];
  if (missing.length > 0 && gift) found.push(finding("R6", gift.number, `The hero's tools must appear in the story: ${missing.join(", ")}`));
  return found;
};

// R8: each act's brave move is a different action, never a near-copy of an earlier one.
export const checkBraveMoveParity: Check = (panels, ctx) => {
  const found: Finding[] = [];
  const moves = byRole(panels, "pivot1", "pivot2", "pivot3").map((p) => ({
    panel: p,
    // The brave-move part: Try → Try Again for beat panels, the whole Final Pivot otherwise.
    sentences: sentences(clean(p.beats ? joinText(p.beats.slice(BEAT.try, BEAT.partialShift)) : p.text, ctx)),
  }));
  for (let later = 1; later < moves.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      const copy = moves[later].sentences.find((s) => moves[earlier].sentences.some((e) => overlap(s, e) >= 0.8 && s.split(/\s+/).length >= 5));
      if (copy) {
        found.push(finding("R8", moves[later].panel.number, `Repeats the brave move from panel ${moves[earlier].panel.number}: "${copy}"`));
        break;
      }
    }
  }
  return found;
};

// Defect 9: garbled words, e.g. "world-future" (two abstract words glued) or "Singer" with a
// capital letter in the middle of a sentence.
export const checkGarble: Check = (panels, ctx) => {
  const found: Finding[] = [];
  const abstract = ABSTRACT_WORDS.join("|");
  const glued = new RegExp(`\\b(?:${abstract})-(?:${abstract})\\b`, "gi");
  for (const panel of panels) {
    const text = clean(panel.text, ctx);
    const odd = matches(text, glued);
    for (const sentence of sentences(text)) {
      const words = sentence.split(/\s+/);
      for (let i = 1; i < words.length; i += 1) {
        const word = words[i].replace(/[^A-Za-z]/g, "");
        if (/^[A-Z][a-z]+$/.test(word) && ROLE_WORDS.includes(word.toLowerCase()) && word !== ctx.heroName) odd.push(word);
      }
    }
    if (odd.length > 0) found.push(finding("D9", panel.number, `Garbled words: ${[...new Set(odd)].join(", ")}`));
  }
  return found;
};

// A two-act story never has Act 3 content.
export const checkTwoAct: Check = (panels, ctx) => {
  if (ctx.answers.storyPath !== "two_act") return [];
  return panels.flatMap((panel) => {
    const phrases = matches(panel.text, THIRD_ACT_PHRASES);
    return phrases.length ? [finding("TWO_ACT", panel.number, `A two-act story has no third challenge: "${phrases[0]}"`)] : [];
  });
};

export const CHECKS: Check[] = [
  checkBeats,
  checkPartialShift,
  checkClinicalWords,
  checkDreamWorld,
  checkEarnedSuccess,
  checkFinalPivotEcho,
  checkCharacter,
  checkBraveMoveParity,
  checkGarble,
  checkTwoAct,
];
