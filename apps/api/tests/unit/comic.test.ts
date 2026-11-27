// BE-11: the comic rules (src/engine/comicPlan.ts), reading the AI's comic page
// (src/ai/comicJson.ts) and the comic prompts. No database, no AI.
import { describe, expect, it } from "vitest";
import { readComicCells } from "../../src/ai/comicJson.js";
import { comicPagePrompt, STAND_IN } from "../../src/ai/prompts.js";
import { StoryJsonError } from "../../src/ai/storyJson.js";
import { cellIndex, cellPosition, cleanSfx, cleanTempo, COMIC_CELL_COUNT, comicPlanFor, PANEL_SHAPES, splitPage, tidyCells, type ComicCellDraft } from "../../src/engine/comicPlan.js";
import { buildContext } from "../../src/engine/index.js";
import { BALLOON_SPACE, comicCellPrompt } from "../../src/engine/visual.js";
import { EMBER_ANSWERS } from "../fixtures/engine/samples.js";

const cell = (over: Partial<ComicCellDraft> = {}): ComicCellDraft => ({ caption: "Ember walked on.", dialogue: null, bubbleType: "none", tempo: null, sfx: null, shot: "medium", scene: "the hero walks", ...over });

describe("BE-11 the comic map", () => {
  it("two acts: 8 pages, 32 cells, never a third-act panel; three acts: 10 pages, 40 cells", () => {
    const two = comicPlanFor("two_act");
    expect(two).toHaveLength(8);
    expect(COMIC_CELL_COUNT.two_act).toBe(32);
    expect(two.flatMap((p) => p.panels)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(two.flatMap((p) => p.roles)).not.toContain("shadow3");
    expect(two.flatMap((p) => p.roles)).not.toContain("pivot3");
    const three = comicPlanFor("three_act");
    expect(three).toHaveLength(10);
    expect(COMIC_CELL_COUNT.three_act).toBe(40);
    expect(three.flatMap((p) => p.panels)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("each brave move gets a whole page; Tempo only on the calm pages", () => {
    const two = comicPlanFor("two_act");
    expect(two.filter((p) => p.braveAct).map((p) => [p.page, p.panels, p.braveAct])).toEqual([
      [3, [5], 1],
      [6, [9], 2],
    ]);
    expect(two.filter((p) => p.tempoAllowed).map((p) => p.page)).toEqual([4, 8]);
    expect(comicPlanFor("three_act").find((p) => p.braveAct === 3)?.panels).toEqual([13]);
  });

  it("panel shapes change with the moment, like a real comic: a big opening, a big brave moment, 4 equal on calm pages", () => {
    const two = comicPlanFor("two_act");
    expect(two[0].layout).toBe("big_top"); // the opening: where are we?
    for (const p of two.filter((x) => x.braveAct)) expect(p.layout).toBe("big_bottom"); // the brave moment, big
    expect(two[two.length - 1].layout).toBe("big_bottom"); // the ending
    expect(two.find((p) => p.roles.includes("rest"))?.layout).toBe("grid"); // a calm page
    expect(new Set(comicPlanFor("three_act").map((p) => p.layout)).size).toBeGreaterThanOrEqual(3);
    for (const shapes of Object.values(PANEL_SHAPES)) expect(shapes).toHaveLength(4);
  });

  it("cell numbers across the comic", () => {
    expect(cellIndex(2, 1)).toBe(5);
    expect(cellPosition(5)).toEqual({ page: 2, cell: 1 });
    expect(cellPosition(40)).toEqual({ page: 10, cell: 4 });
  });
});

describe("BE-11 the cell rules", () => {
  it("Tempo bubbles hold only music notation, never words", () => {
    expect(cleanTempo("♪ ♫ ♪")).toBe("♪ ♫ ♪");
    expect(cleanTempo("la la ♪ hello ♬")).toBe("♪ ♬");
    expect(cleanTempo("Tempo hums a song")).toBeNull();
    expect(cleanTempo("𝄞♩♩")).toBe("𝄞 ♩ ♩");
    expect(cleanTempo(null)).toBeNull();
  });

  it("tidying: Tempo only where allowed and once a page; a bubble only with dialogue; long words cut", () => {
    const [calm, plain] = [comicPlanFor("two_act")[3], comicPlanFor("two_act")[0]];
    const cells = [cell({ tempo: "♪ words ♫" }), cell({ tempo: "♪" }), cell({ dialogue: "Hi", bubbleType: "none" }), cell({ bubbleType: "thought" })];
    const onCalm = tidyCells(cells, calm, "", "the hero");
    expect(onCalm.map((c) => c.tempo)).toEqual(["♪ ♫", null, null, null]);
    expect(onCalm[2]).toMatchObject({ dialogue: "Hi", bubbleType: "speech" });
    expect(onCalm[3].bubbleType).toBe("none");
    expect(tidyCells(cells, plain, "", "the hero").every((c) => c.tempo === null)).toBe(true);
    const long = tidyCells([cell({ caption: "word ".repeat(60) }), cell(), cell(), cell()], plain, "", "the hero");
    expect(long[0].caption.split(/\s+/).length).toBeLessThanOrEqual(30);
  });

  it("the story's inner labels never reach the page; narration only on a couple of panels", () => {
    const pivot = comicPlanFor("two_act")[2];
    const out = tidyCells(
      [cell({ caption: "First Pivot.", dialogue: "Here I go!" }), cell({ caption: "The brave move begins.", dialogue: "Okay." }), cell({ caption: "The wind howled.", dialogue: "Brr!" }), cell({ caption: "Night fell.", dialogue: "Sleep now." })],
      pivot,
      "",
      "the hero",
    );
    expect(out[0].caption).toBe("");
    expect(out[1].caption).toBe("");
    expect(out[2].caption).toBe("The wind howled.");
    expect(out[3].caption).toBe("Night fell.");
    // A plain story line that happens to hold a word like "call" stays.
    expect(tidyCells([cell({ caption: "Mum gave a call from the hill." }), cell(), cell(), cell()], comicPlanFor("two_act")[0], "", "the hero")[0].caption).toBe("Mum gave a call from the hill.");
    const many = tidyCells([cell({ dialogue: "A" }), cell({ dialogue: "B" }), cell({ dialogue: "C" }), cell({ dialogue: "D" })], comicPlanFor("two_act")[0], "", "the hero");
    expect(many.filter((c) => c.caption).length).toBe(2);
  });

  it("sound effects: capitals, one or two words, one a page; shots fit the panel's shape", () => {
    expect(cleanSfx("whoosh!")).toBe("WHOOSH!");
    expect(cleanSfx("DRIP… DROP")).toBe("DRIP DROP");
    expect(cleanSfx("the door went bang loudly")).toBeNull();
    expect(cleanSfx("!")).toBeNull();
    const opening = comicPlanFor("two_act")[0]; // big_top: big, small, small, small
    const out = tidyCells([cell({ sfx: "bang!", shot: "close" }), cell({ sfx: "pop!", shot: "wide" }), cell({ shot: "close" }), cell({ shot: "full" })], opening, "", "the hero");
    expect(out.map((c) => c.sfx)).toEqual(["BANG!", null, null, null]);
    expect(out.map((c) => c.shot)).toEqual(["wide", "close", "close", "close"]);
  });

  it("whisper and shout balloons are kept", () => {
    const out = tidyCells([cell({ dialogue: "Shh…", bubbleType: "whisper" }), cell({ dialogue: "WOW!", bubbleType: "shout" }), cell(), cell()], comicPlanFor("two_act")[0], "", "the hero");
    expect(out.map((c) => c.bubbleType)).toEqual(["whisper", "shout", "none", "none"]);
  });

  it("a brave-move page always speaks the hero's own words", () => {
    const pivot = comicPlanFor("two_act")[2];
    const out = tidyCells([cell(), cell(), cell(), cell()], pivot, "I can start.", "the hero");
    expect(out[1]).toMatchObject({ dialogue: "I can start.", bubbleType: "speech" });
  });

  it("the backup splitter shares the sentences over 4 cells, in order, with no name in the scenes", () => {
    const page = comicPlanFor("two_act")[0];
    const out = splitPage(["Ember lived by the clinic. Ember loved puppies.", "Ember had a kind heart. She whistled. She smiled."], page, "Ember");
    expect(out).toHaveLength(4);
    expect(out.map((c) => c.caption).join(" ")).toBe("Ember lived by the clinic. Ember loved puppies. Ember had a kind heart. She whistled. She smiled.");
    for (const c of out) expect(c.scene).not.toContain("Ember");
  });

  it("the backup splitter puts what the hero says (in quotes) in a speech bubble", () => {
    const page = comicPlanFor("two_act")[0];
    const out = splitPage(['Ember looked at the hill. "I will climb it!" Ember smiled.', "The wind blew.", "The sun rose.", "Birds sang."], page, "Ember");
    const talking = out.find((c) => c.dialogue);
    expect(talking).toMatchObject({ dialogue: "I will climb it!", bubbleType: "speech" });
    expect(talking!.caption).not.toContain("I will climb it");
  });

  it("the backup splitter never uses the story's labels as words", () => {
    const out = splitPage(["One short line."], comicPlanFor("two_act")[2], "Ember");
    expect(out.map((c) => c.caption)).toEqual(["One short line.", "", "", ""]);
  });
});

describe("BE-11 reading the AI's comic page", () => {
  const json = (cells: unknown[]) => JSON.stringify({ cells });
  const good = Array.from({ length: 4 }, (_, i) => ({ caption: `${STAND_IN} looks around ${i}.`, dialogue: i === 3 ? null : `I'm ${STAND_IN}!`, bubble: i === 3 ? "none" : "speech", tempo: null, scene: `${STAND_IN} looks at the sky` }));

  it("exactly 4 cells; the real name goes back into the words, never into the scene", () => {
    const cells = readComicCells(`\`\`\`json\n${json(good)}\n\`\`\``, "Zara", STAND_IN);
    expect(cells[0].caption).toBe("Zara looks around 0.");
    expect(cells[1].dialogue).toBe("I'm Zara!");
    expect(cells[0].scene).toBe("the hero looks at the sky");
  });

  it("anything else fails the try (the queue retries)", () => {
    expect(() => readComicCells(json(good.slice(0, 3)), "Zara", STAND_IN)).toThrow(StoryJsonError);
    expect(() => readComicCells("sorry, no", "Zara", STAND_IN)).toThrow(StoryJsonError);
  });

  it("a page where fewer than 2 panels talk is tried again", () => {
    const quiet = good.map((c, i) => (i >= 1 ? { ...c, dialogue: null, bubble: "none" } : c));
    expect(() => readComicCells(json(quiet), "Zara", STAND_IN)).toThrow(/Only 1 of 4 cells have dialogue/);
  });

  it("no narration, a sound effect and a shot are read too", () => {
    const cells = readComicCells(json(good.map((c, i) => (i === 0 ? { ...c, caption: "", sfx: "WHOOSH!", shot: "wide" } : c))), "Zara", STAND_IN);
    expect(cells[0]).toMatchObject({ caption: "", sfx: "WHOOSH!", shot: "wide" });
  });

  it("the page prompt: the comic rules, the panels' shapes and shots, and never the story's labels", () => {
    const ctx = { ...buildContext(EMBER_ANSWERS), aiName: STAND_IN };
    const prompt = comicPagePrompt(ctx, comicPlanFor("two_act")[0], [{ number: 1, label: "Identity Anchor", text: "Ember woke up." }], 8);
    expect(prompt.system).toContain("The PICTURE tells the story");
    expect(prompt.system).toContain("One single action");
    expect(prompt.prompt).toContain("Panel 1: a BIG panel");
    expect(prompt.prompt).toContain('"whisper"');
    expect(prompt.prompt).toContain('"sfx"');
    expect(prompt.prompt).not.toContain("Identity Anchor");
  });

  it("the page prompt never contains the hero's real name", () => {
    const ctx = { ...buildContext({ ...EMBER_ANSWERS, charName: "Zara", heroWords: "Zara can do it." }), aiName: STAND_IN };
    const page = comicPlanFor("two_act")[2];
    const prompt = comicPagePrompt(ctx, page, [{ number: 5, label: "First Pivot", text: "Zara took a breath." }], 8);
    expect(`${prompt.system}\n${prompt.prompt}`).not.toContain("Zara");
    expect(prompt.prompt).toContain(`${STAND_IN} took a breath.`);
    expect(prompt.prompt).toContain("brave words");
  });

  it("the cell picture: the chosen look as a comic panel, the hero's fixed look, Tempo when asked, no words", () => {
    const ctx = buildContext({ ...EMBER_ANSWERS, comicVibe: "indie-graphic-novel" });
    const withTempo = comicCellPrompt(ctx, "the hero rests", true);
    expect(withTempo).toContain("graphic novel");
    expect(withTempo).toContain("comic book");
    expect(withTempo).toContain("golden-tipped tail");
    expect(withTempo).toContain("squirrel");
    expect(withTempo).toContain("No text");
    expect(withTempo).toContain("Expressive face");
    expect(comicCellPrompt(ctx, "x", false)).not.toContain("squirrel");
    // A panel with a balloon (drawn on the picture, top-left) gets calm space for it; others don't.
    expect(comicCellPrompt(ctx, "x", false, "medium", true)).toContain(BALLOON_SPACE);
    expect(withTempo).not.toContain(BALLOON_SPACE);
    // The camera fits the panel: a wide view for a big panel, a face for a small one.
    expect(comicCellPrompt(ctx, "x", false, "wide")).toContain("wide establishing shot");
    expect(comicCellPrompt(ctx, "x", false, "close")).toContain("close-up");
  });
});
