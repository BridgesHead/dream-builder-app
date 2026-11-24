// BE-09 acceptance criteria from the guide, plus the plan, the story context and the director.
import { describe, expect, it } from "vitest";
import { buildContext, BEAT_NAMES, planFor, runEngine } from "../../../src/engine/index.js";
import { coreNounFor, dreamWorldFor } from "../../../src/engine/context.js";
import { directStory } from "../../../src/engine/director.js";
import { EMBER_ANSWERS, EMBER_TWO_ACT, EMBER_TWO_ACT_DRAFT, copyOf, panel } from "../../fixtures/engine/samples.js";
import { runOn, textOf } from "./helpers.js";

describe("guide BE-09 acceptance", () => {
  it("Panels 5 and 9 contain all eight beats, in order", () => {
    const result = runOn();
    expect(result.rewrite).toEqual([]);
    // The beats are joined in order into the panel's text.
    const text = textOf(result, 5);
    expect(text.indexOf("Grumpy Giant stomped")).toBeLessThan(text.indexOf("tail bristled"));
    expect(text.indexOf("remembered her kind heart")).toBeLessThan(text.indexOf("narrow way past him"));
    for (const n of [5, 9]) expect(runOn((d) => panel(d, n).beats!.pop()).rewrite[0]).toMatchObject({ rule: "BEATS", panelNumber: n });
  });

  it("a two-act story never contains Act 3 text", () => {
    const result = runEngine(EMBER_TWO_ACT_DRAFT, buildContext(EMBER_TWO_ACT));
    expect(result.panels).toHaveLength(12);
    expect(result.panels.map((p) => p.text).join(" ")).not.toContain("Roaring Fire");
    // An Act 3 panel, or talk of a third challenge, is refused.
    expect(runEngine([...copyOf(EMBER_TWO_ACT_DRAFT), { number: 13, text: "x" }], buildContext(EMBER_TWO_ACT)).fatal).not.toBeNull();
    const third = copyOf(EMBER_TWO_ACT_DRAFT);
    panel(third, 10).text = "It took many tries, and then one last challenge appeared.";
    expect(runEngine(third, buildContext(EMBER_TWO_ACT)).rewrite).toEqual([expect.objectContaining({ rule: "TWO_ACT", panelNumber: 10 })]);
  });

  it("on three acts, heroWords3 appears word for word in quotation marks in Panel 12", () => {
    expect(textOf(runOn(), 12)).toMatch(/"I can keep going one step at a time\."$/);
  });

  it('the final panel ends with "One real step today."', () => {
    expect(textOf(runOn(), 15).endsWith("One real step today.")).toBe(true);
    const twoAct = runEngine(EMBER_TWO_ACT_DRAFT, buildContext(EMBER_TWO_ACT));
    expect(textOf(twoAct, 12).endsWith("One real step today.")).toBe(true);
  });

  it("the Grand Finale has the Brave-Step phrase with the right pronoun", () => {
    expect(textOf(runOn(), 14)).toContain("took her next brave step toward becoming the vet");
  });

  it("the obstacle never disappears: banned words in resolution beats are caught", () => {
    const beat8 = runOn((d) => (panel(d, 5).beats![7] = "The Giant vanished into the hills."));
    expect(beat8.rewrite).toEqual([expect.objectContaining({ rule: "PARTIAL_SHIFT", panelNumber: 5, message: expect.stringContaining("vanished") })]);
    const finale = runOn((d) => (panel(d, 14).text = "In the clinic the worry was gone, and Ember took her next brave step toward becoming the vet."));
    expect(finale.rewrite).toEqual([expect.objectContaining({ rule: "PARTIAL_SHIFT", panelNumber: 14 })]);
    // The same word outside a resolution beat is fine.
    expect(runOn((d) => (panel(d, 6).text = "Ember felt jumpy; her courage seemed gone for a moment, but she stayed.")).rewrite).toEqual([]);
  });
});

describe("the panel plans", () => {
  it("three acts: 15 panels with the PRD labels", () => {
    const plan = planFor("three_act");
    expect(plan.map((p) => p.label)).toEqual([
      "Identity Anchor", "Internal Gift", "The Call", "First Shadow", "First Pivot", "The Heavy Heart", "Rest & Restoration",
      "Second Shadow", "Second Brave Move", "Persistence", "Plateau Triumph",
      "Third Shadow / Deepest Pause", "Final Pivot", "Grand Finale", "Practice Anchor",
    ]);
    expect(plan.filter((p) => p.beats).map((p) => p.number)).toEqual([5, 9]);
  });
  it("two acts: 12 panels ending with the Grand Finale and the Practice Anchor, no Act 3", () => {
    const plan = planFor("two_act");
    expect(plan).toHaveLength(12);
    expect(plan.slice(-2).map((p) => p.label)).toEqual(["Grand Finale", "Practice Anchor"]);
    expect(plan.some((p) => p.role === "shadow3" || p.role === "pivot3")).toBe(false);
  });
});

describe("the story context", () => {
  it("Core Noun: a role from the dream, the dream world's noun for an action, or 'dreamer'", () => {
    expect(coreNounFor("be a vet", dreamWorldFor("be a vet"))).toBe("vet");
    expect(coreNounFor("To become an astronaut.", null)).toBe("astronaut");
    expect(coreNounFor("fly to the moon", dreamWorldFor("fly to the moon"))).toBe("astronaut");
    expect(coreNounFor("score the winning goal", dreamWorldFor("score the winning goal"))).toBe("footballer");
    expect(coreNounFor("be happy every day", dreamWorldFor("be happy every day"))).toBe("happy every day");
    expect(coreNounFor("make everyone smile", dreamWorldFor("make everyone smile"))).toBe("dreamer");
  });
  it("hero name falls back from charName to the hero's default name", () => {
    expect(buildContext({ ...EMBER_ANSWERS, charName: "  " }).heroName).toBe("Ember");
    expect(buildContext({ ...EMBER_ANSWERS, charName: "", heroType: "robot" }).heroName).toBe("Sparky");
  });
  it("refuses a story with no pronoun", () => {
    expect(() => buildContext({ ...EMBER_ANSWERS, heroPronoun: null })).toThrow();
  });
});

describe("the director", () => {
  it("briefs every planned panel, with eight beats and the child's words on the brave-move panels", () => {
    const brief = directStory(buildContext(EMBER_ANSWERS));
    expect(brief.panels).toHaveLength(15);
    const five = brief.panels[4];
    expect(five.beats!.map((b) => b.name)).toEqual([...BEAT_NAMES]);
    expect(five.beats![3].instructions).toContain('"I can start with one small step."');
    expect(five.beats![2].instructions).toContain("tail bristles");
    expect(brief.panels[11].instructions).toContain("I can keep going one step at a time.");
    expect(brief.panels[13].instructions).toContain("Ember took her next brave step toward becoming the vet");
    expect(brief.panels[14].instructions).toContain("One real step today.");
  });
  it("a two-act brief has 12 panels and says there is no third challenge", () => {
    const brief = directStory(buildContext(EMBER_TWO_ACT));
    expect(brief.panels).toHaveLength(12);
    expect(brief.rules.join(" ")).toContain("no third challenge");
  });
});
