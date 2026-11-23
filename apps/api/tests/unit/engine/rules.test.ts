// BE-09: one test per Narrative Integrity Rule (PRD §6), on fixed samples, no AI calls.
// Each test: the good sample passes; a known-bad copy is caught; after the fix it passes.
import { describe, expect, it } from "vitest";
import { buildContext, runEngine } from "../../../src/engine/index.js";
import { EMBER_ANSWERS, EMBER_THREE_ACT, EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT, panel } from "../../fixtures/engine/samples.js";
import { rerun, rulesIn, runOn, textOf } from "./helpers.js";

describe("the good samples", () => {
  it("a good three-act story passes with nothing to repair or rewrite", () => {
    const result = runOn();
    expect(result).toMatchObject({ fatal: null, repaired: [], rewrite: [] });
    expect(result.panels).toHaveLength(15);
  });
  it("a good two-act story passes too", () => {
    const result = runEngine(EMBER_TWO_ACT_DRAFT, buildContext(EMBER_TWO_ACT));
    expect(result).toMatchObject({ fatal: null, repaired: [], rewrite: [] });
    expect(result.panels).toHaveLength(12);
  });
});

describe("R1 No clinical labels", () => {
  it("a clinical word with a poetic name is swapped for it", () => {
    const result = runOn((d) => (panel(d, 6).text = "Ember felt her anxiety rise, but she stayed."));
    expect(rulesIn(result.repaired)).toEqual(["R1"]);
    expect(textOf(result, 6)).toContain("her Humming Mist rise"); // no "her the …"
    expect(textOf(result, 6)).not.toMatch(/anxiety/i);
    expect(rerun(result).repaired).toEqual([]);
  });
  it("keeps 'the' when nothing comes before it", () => {
    const result = runOn((d) => (panel(d, 6).text = "Ember felt jumpy as anxiety crept closer, but she stayed."));
    expect(textOf(result, 6)).toContain("as the Humming Mist crept closer");
  });
  it("a clinical word with no safe swap sends the panel back for a rewrite", () => {
    const result = runOn((d) => (panel(d, 6).text = "Ember remembered what her therapist said, and she stayed."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R1", panelNumber: 6 })]);
  });
  it("never changes the child's own words", () => {
    const answers = { ...EMBER_ANSWERS, heroWords: "My anxiety is small today." };
    const result = runOn((d) => (panel(d, 5).beats![3] = 'She said, "My anxiety is small today."'), answers);
    expect(textOf(result, 5)).toContain("My anxiety is small today.");
    expect(rulesIn(result.repaired)).not.toContain("R1");
  });
});

describe("R2 Aspiration grounding", () => {
  it("a key panel outside the dream world is sent for a rewrite", () => {
    const result = runOn((d) => (panel(d, 3).text = "Each morning she dreamed of mountains far away."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R2", panelNumber: 3 })]);
  });
  it("isn't checked when the dream matches no dream-world row", () => {
    const answers = { ...EMBER_ANSWERS, aspiration: "be happy" };
    const result = runOn((d) => (panel(d, 3).text = "Each morning she dreamed of mountains far away."), answers);
    expect(rulesIn(result.rewrite)).not.toContain("R2");
  });
});

describe("R3 Earned Success Bridge", () => {
  it("magic in a triumph panel is sent for a rewrite", () => {
    const result = runOn((d) => (panel(d, 11).text = "Suddenly, with a flick of magic, Ember was standing in the clinic."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R3", panelNumber: 11 })]);
  });
});

describe("R4 Authentic child voice (Act 3)", () => {
  it("the child's Act 3 words are put at the very end of Panel 12, in quotes", () => {
    const result = runOn((d) => (panel(d, 12).text = "Then a Roaring Fire of worry flared up, and Ember sat down, very tired."));
    expect(rulesIn(result.repaired)).toEqual(["R4"]);
    expect(textOf(result, 12).endsWith('"I can keep going one step at a time."')).toBe(true);
    expect(rerun(result).repaired).toEqual([]);
  });
  it("Panel 13 must not repeat them word for word (echo in prose only)", () => {
    const result = runOn((d) => (panel(d, 13).text = 'Ember said again, "I can keep going one step at a time," and breathed slowly.'));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R4", panelNumber: 13 })]);
  });
  it("the hero's own name in Panel 13 is not copying, even if the child's words are just that name", () => {
    // Found in a dev test: hero "pip", Act 3 words "pip". Panel 13 always names the hero, so
    // the old check could never pass and generation failed every try.
    const result = runOn(() => undefined, { ...EMBER_ANSWERS, heroWords3: "Ember" });
    expect(result.rewrite.filter((f) => f.rule === "R4")).toEqual([]);
  });
  it("matches whole words only: 'pip' is not found inside 'pipe'", () => {
    const pip = { ...EMBER_ANSWERS, heroWords3: "pipe" };
    const result = runOn((d) => (panel(d, 13).text = "Ember followed the old pip of light, breathing slowly, until a way through appeared."), pip);
    expect(result.rewrite.filter((f) => f.rule === "R4")).toEqual([]);
  });
});

describe("R5 Inner voice format", () => {
  it("a thought in double quotes is put in single quotes", () => {
    const result = runOn((d) => (panel(d, 2).text = 'Ember had a kind heart and round glasses. "Maybe I can help," Ember thought.'));
    expect(rulesIn(result.repaired)).toEqual(["R5"]);
    expect(textOf(result, 2)).toContain("'Maybe I can help,' Ember thought");
  });
});

describe("R6 Character consistency", () => {
  it("the hero must be named in the first panel and the Grand Finale", () => {
    const result = runOn((d) => (panel(d, 1).text = "A clever young fox with a golden tail lived beside a busy animal clinic."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R6", panelNumber: 1 })]);
  });
  it("the hero's tools must appear in the story", () => {
    const result = runOn((d) => {
      panel(d, 2).text = "Ember had a kind heart and noticed every tiny paw print. 'Maybe I can help them all,' Ember thought.";
      panel(d, 5).beats![5] = "Ember remembered her kind heart.";
    });
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "R6", panelNumber: 2, message: expect.stringContaining("glasses") })]);
  });
});

describe("R7 Open agency (One Brave Sentence)", () => {
  it("the child's brave sentence is added word for word to the Try beat when missing", () => {
    const result = runOn((d) => (panel(d, 5).beats![3] = "She lifted her chin and called out bravely."));
    expect(rulesIn(result.repaired)).toEqual(["R7"]);
    expect(textOf(result, 5)).toContain('"I can start with one small step."');
  });
  it("…and heroWords2 in Panel 9", () => {
    const result = runOn((d) => (panel(d, 9).beats![3] = "Ember stood tall in front of the other helpers."));
    expect(result.repaired).toEqual([expect.objectContaining({ rule: "R7", panelNumber: 9 })]);
    expect(textOf(result, 9)).toContain("I'll try another way.");
  });
});

describe("R8 Brave move parity", () => {
  it("a brave move copied from an earlier act is sent for a rewrite", () => {
    const result = runOn((d) => {
      const first = panel(d, 5).beats!;
      panel(d, 9).beats!.splice(4, 3, first[4], first[5], first[6]);
    });
    expect(result.rewrite).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "R8", panelNumber: 9 })]));
  });
});

describe("R9 Practice Anchor closure", () => {
  it('the last panel always ends with "One real step today."', () => {
    const result = runOn((d) => (panel(d, 15).text = "Whenever something hard stands in your way, you can choose one small brave step."));
    expect(rulesIn(result.repaired)).toEqual(["R9"]);
    expect(textOf(result, 15).endsWith("One real step today.")).toBe(true);
    expect(rerun(result).repaired).toEqual([]);
  });
});

describe("R10 Brave-Step Mandate", () => {
  it("the Grand Finale gets the Brave-Step sentence, with the right pronoun and Core Noun", () => {
    const result = runOn((d) => (panel(d, 14).text = "In the warm clinic, surrounded by animals she had helped, Ember smiled."));
    expect(rulesIn(result.repaired)).toEqual(["R10"]);
    expect(textOf(result, 14)).toContain("Ember took her next brave step toward becoming the vet.");
  });
  it('uses "his" for a "he" hero', () => {
    const answers = { ...EMBER_ANSWERS, heroPronoun: "he" };
    const result = runEngine(EMBER_THREE_ACT, buildContext(answers));
    expect(textOf(result, 14)).toContain("Ember took his next brave step toward becoming the vet.");
  });
});
