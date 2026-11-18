// BE-09: one test per defect fixed in this story (PRD §7 known gaps, guide defects 3–7 and 9).
// Each one fails on a known-bad sample (the engine catches it) and passes after the fix.
import { describe, expect, it } from "vitest";
import { buildContext, runEngine } from "../../../src/engine/index.js";
import { EMBER_ANSWERS, EMBER_THREE_ACT, copyOf, panel } from "../../fixtures/engine/samples.js";
import { rerun, rulesIn, runOn, textOf } from "./helpers.js";

describe("D3 Bleed-guard: another hero's details are caught and reported", () => {
  it("another hero's name", () => {
    const result = runOn((d) => (panel(d, 4).text = "One day Sparky the robot sat right in front of the clinic gate."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "D3", panelNumber: 4, message: expect.stringContaining("Sparky") })]);
  });
  it("another hero's body signal or body part", () => {
    const result = runOn((d) => (panel(d, 6).text = "Ember felt jumpy and small. Ember's gears ground, but she stayed."));
    expect(rulesIn(result.rewrite)).toEqual(["D3"]);
    expect(result.rewrite.length).toBe(2); // the robot's signal, and the robot's gears
  });
  it("a fixed panel passes", () => {
    expect(runOn().rewrite).toEqual([]);
  });
});

describe("D4 Panel 5 eight-beat arc: beats 6 and 7 must be there", () => {
  it("missing Re-center and Try Again beats are caught", () => {
    const result = runOn((d) => {
      panel(d, 5).beats![5] = "";
      panel(d, 5).beats![6] = "";
    });
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "BEATS", panelNumber: 5, message: "Missing beats: Re-center, Try Again" })]);
  });
  it("fused beats (the same sentence twice) are caught", () => {
    const result = runOn((d) => (panel(d, 5).beats![6] = panel(d, 5).beats![5]));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "BEATS", message: expect.stringContaining("are the same") })]);
  });
  it("fewer than eight beats are caught", () => {
    const result = runOn((d) => panel(d, 5).beats!.splice(5, 2));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "BEATS", message: "Has 6 beats; it needs all 8, in order" })]);
  });
  it("a brave-move panel sent as plain text is caught", () => {
    const result = runOn((d) => {
      d[4] = { number: 5, text: "Ember faced the Giant and walked past." };
    });
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "BEATS", message: "Must be written as the eight beats" })]);
  });
  it("the Signal beat must be this hero's body signal", () => {
    const result = runOn((d) => (panel(d, 5).beats![2] = "Her ears twitched and her paws felt heavy."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "BEATS", message: expect.stringContaining("tail bristles") })]);
  });
});

describe("D5 Panel 6 skipped (and Panel 7 blank)", () => {
  it("a skipped Panel 6 is sent for a rewrite, never padded", () => {
    const result = runOn((d) => d.splice(5, 1));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "PANELS", panelNumber: 6, message: "Panel 6 (The Heavy Heart) is missing" })]);
  });
  it("a blank Panel 7 is sent for a rewrite", () => {
    const result = runOn((d) => (panel(d, 7).text = "   "));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "PANELS", panelNumber: 7, message: "Panel 7 (Rest & Restoration) is empty" })]);
  });
  it("extra panels fail the whole try (never cut)", () => {
    const result = runOn((d) => d.push({ number: 16, text: "One more page." }));
    expect(result.fatal).toContain("Expected panels 1–15");
  });
  it("after the rewrite the story passes", () => {
    const draft = copyOf(EMBER_THREE_ACT);
    expect(runEngine(draft, buildContext(EMBER_ANSWERS)).rewrite).toEqual([]);
  });
});

describe("D6 Strategy label in the Grand Finale", () => {
  it("the strategy label is removed", () => {
    const result = runOn(
      (d) => (panel(d, 14).text = "Using the One Brave Sentence strategy in the warm clinic, Ember took her next brave step toward becoming the vet."),
    );
    expect(rulesIn(result.repaired)).toEqual(["D6"]);
    expect(textOf(result, 14)).not.toMatch(/strategy|One Brave Sentence/i);
    expect(textOf(result, 14)).toContain("Using brave words in the warm clinic");
    expect(rerun(result).repaired).toEqual([]);
  });
});

describe("D7 Pronoun object-case", () => {
  it('"leaving she" becomes "leaving her"', () => {
    const result = runOn((d) => (panel(d, 7).text = "The day ended, leaving she tired, so Ember rested in the tree house and the animals cheered for she."));
    expect(result.repaired.map((f) => f.rule)).toEqual(["D7", "D7"]);
    expect(textOf(result, 7)).toContain("leaving her tired");
    expect(textOf(result, 7)).toContain("cheered for her");
  });
  it('leaves a pronoun that starts a new clause alone ("told he was")', () => {
    const result = runOn((d) => (panel(d, 7).text = "Pip told Ember that the vet thought she was ready, and Ember rested in the tree house."));
    expect(rulesIn(result.repaired)).not.toContain("D7");
  });
});

describe("D9 Vocabulary garble", () => {
  it('"world-future Singer" is caught and sent for a rewrite', () => {
    const result = runOn((d) => (panel(d, 10).text = "It took many tries, and her world-future Singer dreams kept her going."));
    expect(result.rewrite).toEqual([expect.objectContaining({ rule: "D9", panelNumber: 10, message: expect.stringContaining("world-future") })]);
  });
});
