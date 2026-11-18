import { braveStepPhrase, PRACTICE_TAG, type StoryContext } from "../context.js";
import { BEAT } from "../plan.js";
import {
  CLINICAL_WORDS,
  OBJECT_POSITION_WORDS,
  ONE_BRAVE_SENTENCE,
  STRATEGY_WORD,
  SUBJECT_FOLLOWERS,
} from "../tables.js";
import { capitalise, comparable, containsVerbatim, outsideChildWords, straightQuotes } from "../text.js";
import { finding, type Finding, type WorkPanel } from "../types.js";

// REPAIRS: small, certain fixes the engine makes itself (decision 2A). Each one changes the
// panel and returns what it fixed, so it's logged on the job record. None of them ever
// changes the child's own words.

type Repair = (panel: WorkPanel, ctx: StoryContext) => Finding[];

// R1: a clinical word with a known poetic name is swapped for it ("anxiety" → "the Humming Mist").
// Clinical words with no safe swap are left for the checks, which ask for a rewrite.
export const repairClinicalWords: Repair = (panel, ctx) => {
  const found: Finding[] = [];
  panel.text = outsideChildWords(panel.text, ctx.childWords, (part) => {
    let out = part;
    for (const { pattern, poetic } of CLINICAL_WORDS) {
      if (!poetic) continue;
      out = out.replace(pattern, (word: string, offset: number, whole: string) => {
        // "her anxiety" → "her Humming Mist", not "her the Humming Mist".
        const afterDeterminer = /\b(?:her|his|my|your|their|our|its|the|a|an)\s+$/i.test(whole.slice(0, offset));
        const swap = afterDeterminer ? poetic.replace(/^the\s+/i, "") : poetic;
        found.push(finding("R1", panel.number, `"${word}" replaced with "${swap}"`));
        return swap;
      });
    }
    return out;
  });
  return found;
};

// R5: the hero's thoughts use single quotes: 'Maybe I can,' Sparky thought.
export const repairInnerVoice: Repair = (panel, ctx) => {
  const found: Finding[] = [];
  const thinker = `(${ctx.heroName}|${ctx.pronoun.subject}|${capitalise(ctx.pronoun.subject)})`;
  const doubleQuoted = new RegExp(`"([^"]+?)"(\\s+${thinker}\\s+(?:thought|wondered))`, "g");
  panel.text = outsideChildWords(panel.text, ctx.childWords, (part) =>
    part.replace(doubleQuoted, (_all, thought: string, rest: string) => {
      found.push(finding("R5", panel.number, `Thought put in single quotes: '${thought}'`));
      return `'${thought}'${rest}`;
    }),
  );
  return found;
};

// D7: a subject pronoun where an object belongs: "leaving she" → "leaving her".
export const repairPronounCase: Repair = (panel, ctx) => {
  const found: Finding[] = [];
  const pattern = new RegExp(
    `\\b(${OBJECT_POSITION_WORDS.join("|")})\\s+(she|he)\\b(?!\\s+(?:${SUBJECT_FOLLOWERS.join("|")})\\b)`,
    "gi",
  );
  panel.text = outsideChildWords(panel.text, ctx.childWords, (part) =>
    part.replace(pattern, (_all, before: string, pronoun: string) => {
      const fixed = pronoun.toLowerCase() === "she" ? "her" : "him";
      found.push(finding("D7", panel.number, `"${before} ${pronoun}" → "${before} ${fixed}"`));
      return `${before} ${fixed}`;
    }),
  );
  return found;
};

// D6: the Grand Finale names the strategy label ("the One Brave Sentence strategy").
export const repairStrategyLabel: Repair = (panel, ctx) => {
  const found: Finding[] = [];
  panel.text = outsideChildWords(panel.text, ctx.childWords, (part) =>
    part
      .replace(ONE_BRAVE_SENTENCE, (label) => {
        found.push(finding("D6", panel.number, `Strategy label "${label.trim()}" replaced with "brave words"`));
        return "brave words";
      })
      .replace(STRATEGY_WORD, (word) => {
        found.push(finding("D6", panel.number, `Strategy label word "${word.trim()}" removed`));
        return "";
      }),
  );
  return found;
};

// R7: the child's One Brave Sentence, word for word, in the Try beat (beat 4) of the
// brave-move panels: heroWords in Panel 5, heroWords2 in Panel 9.
export function repairOpenAgency(panel: WorkPanel, ctx: StoryContext): Finding[] {
  if (!panel.beats) return [];
  const words = panel.plan.role === "pivot1" ? ctx.heroWords[1] : panel.plan.role === "pivot2" ? ctx.heroWords[2] : "";
  if (!words || containsVerbatim(panel.beats[BEAT.try], words)) return [];
  // The child's words exactly as typed; only a full stop is added if they ended without one.
  const spoken = /[.!?]$/.test(words) ? words : `${words}.`;
  panel.beats[BEAT.try] = `${panel.beats[BEAT.try].trim()} ${ctx.heroName} said, "${spoken}"`;
  return [finding("R7", panel.number, "The child's brave sentence was missing from the Try beat; added word for word")];
}

// R4: in a three-act story the child's Act 3 words end Panel 12, word for word, in quotes.
export function repairActThreeVoice(panel: WorkPanel, ctx: StoryContext): Finding[] {
  const words = ctx.heroWords[3];
  if (panel.plan.role !== "shadow3" || !words) return [];
  const last = /"([^"]+)"\s*$/.exec(straightQuotes(panel.text).trimEnd());
  if (last && comparable(last[1]) === comparable(words)) return [];
  panel.text = `${panel.text.trimEnd()} "${words}"`;
  return [finding("R4", panel.number, "The child's Act 3 words weren't at the end of the panel; added word for word")];
}

// R10: the Grand Finale has "took her next brave step toward becoming the [Core Noun]".
export function repairBraveStep(panel: WorkPanel, ctx: StoryContext): Finding[] {
  if (panel.plan.role !== "finale") return [];
  const phrase = braveStepPhrase(ctx);
  if (panel.text.toLowerCase().includes(phrase.toLowerCase())) return [];
  panel.text = `${panel.text.trimEnd()} ${ctx.heroName} ${phrase}.`;
  return [finding("R10", panel.number, `Added the Brave-Step sentence: "${phrase}"`)];
}

// R9: the last panel ends with exactly "One real step today."
export function repairPracticeTag(panel: WorkPanel): Finding[] {
  if (panel.plan.role !== "anchor") return [];
  if (panel.text.trimEnd().endsWith(PRACTICE_TAG)) return [];
  panel.text = `${panel.text.trimEnd()} ${PRACTICE_TAG}`;
  return [finding("R9", panel.number, `Added the closing line "${PRACTICE_TAG}"`)];
}
