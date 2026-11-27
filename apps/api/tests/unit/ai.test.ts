// BE-10 unit tests: reading the AI's answers, hiding the hero's name, the picture prompt,
// the Scene Director fallbacks and picture links. No AI calls, no database.
import { describe, expect, it } from "vitest";
import { hideName, readScene, readTitle, revealName, STAND_IN, storyTextPrompt, titlePrompt } from "../../src/ai/prompts.js";
import { readStoryPanels, StoryJsonError } from "../../src/ai/storyJson.js";
import { buildContext } from "../../src/engine/index.js";
import { fallbackTitle, imagePrompt, sceneFallback, seedFor, UNIVERSAL_TRIUMPH } from "../../src/engine/visual.js";
import { isSafeKey, panelImageKey, readSignedLocal, s3Storage, getStorage } from "../../src/lib/storage.js";
import { EMBER_ANSWERS, EMBER_TWO_ACT } from "../fixtures/engine/samples.js";

const zara = buildContext({ ...EMBER_ANSWERS, charName: "Zara" });

describe("hiding the hero's name (decision 6A)", () => {
  it("swaps whole words only, in both directions", () => {
    expect(hideName("Zara and Zara's friend met Zarathustra.", "Zara")).toBe(`${STAND_IN} and ${STAND_IN}'s friend met Zarathustra.`);
    expect(revealName(`${STAND_IN} smiled.`, "Zara")).toBe("Zara smiled.");
  });
  it("the story prompt and the title prompt never contain the name", () => {
    const answers = { ...EMBER_ANSWERS, charName: "Zara", heroWords: "Zara can do it.", safePlaceText: "Zara's den" };
    const ctx = buildContext(answers);
    for (const p of [storyTextPrompt(ctx), titlePrompt(ctx)]) {
      expect(p.system + p.prompt).not.toContain("Zara");
      expect(p.system + p.prompt).toContain(STAND_IN);
    }
  });
  it("asks for exactly the planned number of panels", () => {
    expect(storyTextPrompt(zara).prompt).toContain("exactly 15 panels");
    expect(storyTextPrompt(buildContext(EMBER_TWO_ACT)).prompt).toContain("exactly 12 panels");
  });
});

describe("reading the story JSON", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, text: `${STAND_IN} walked on.` }));
  const want = twelve.map((p) => p.number);

  it("accepts JSON in a ```json fence and puts the name back", () => {
    const panels = readStoryPanels("Here you go:\n```json\n" + JSON.stringify({ panels: twelve }) + "\n```", want, "Zara");
    expect(panels).toHaveLength(12);
    expect(panels[0].text).toBe("Zara walked on.");
  });
  it("brave-move panels keep their beats", () => {
    const withBeats = twelve.map((p) => (p.number === 5 ? { number: 5, beats: Array(8).fill(`${STAND_IN} tried.`) } : p));
    expect(readStoryPanels(JSON.stringify({ panels: withBeats }), want, "Zara")[4].beats).toEqual(Array(8).fill("Zara tried."));
  });
  it.each([
    ["not JSON at all", "Once upon a time…", "no JSON"],
    ["broken JSON", '{ "panels": [ { "number": 1, ', "no JSON"],
    ["broken JSON inside braces", '{ "panels": [ oops ] }', "wasn't valid JSON"],
    ["the wrong shape", '{ "pages": [] }', "panel shape"],
    ["11 panels instead of 12", JSON.stringify({ panels: twelve.slice(0, 11) }), "Expected 12 panels"],
    ["13 panels instead of 12", JSON.stringify({ panels: [...twelve, { number: 13, text: "x" }] }), "Expected 12 panels"],
    ["a panel twice", JSON.stringify({ panels: [...twelve.slice(0, 11), { number: 1, text: "x" }] }), "Expected 12 panels"],
  ])("refuses %s (so the queue retries)", (_name, raw, message) => {
    expect(() => readStoryPanels(raw, want, "Zara")).toThrow(StoryJsonError);
    expect(() => readStoryPanels(raw, want, "Zara")).toThrow(message);
  });
});

describe("the title (PRD F12)", () => {
  it("takes the AI's title when it has the right shape", () => {
    expect(readTitle(`"${STAND_IN} and the Whispering Clinic."`, "Zara")).toBe("Zara and the Whispering Clinic");
  });
  it.each(["A Story About Being Brave", `${STAND_IN} and the`, `${STAND_IN} and the very very very long poetic dream title`])("refuses %j", (raw) => {
    expect(readTitle(raw, "Zara")).toBeNull();
  });
  it("the formula fallback uses the dream world's poetic name", () => {
    expect(fallbackTitle(zara)).toBe("Zara and the Healing Meadow");
    expect(fallbackTitle(buildContext({ ...EMBER_ANSWERS, aspiration: "be happy" }))).toBe("Ember and the Brightest Dream");
  });
});

describe("pictures (PRD F6)", () => {
  it("the seed is the same for every panel of a story, and differs for another hero or dream", () => {
    expect(seedFor(zara)).toBe(seedFor(buildContext({ ...EMBER_ANSWERS, charName: "Zara" })));
    expect(seedFor(zara)).not.toBe(seedFor(buildContext({ ...EMBER_ANSWERS, charName: "Milo" })));
    expect(seedFor(zara)).not.toBe(seedFor(buildContext({ ...EMBER_ANSWERS, charName: "Zara", aspiration: "be a chef" })));
  });
  it("Explorer = watercolour, Creator = concept art; the hero's look on every prompt; no names", () => {
    const junior = imagePrompt(zara, "the hero at the gate");
    const senior = imagePrompt(buildContext({ ...EMBER_ANSWERS, charName: "Zara", mode: "senior" }), "the hero at the gate");
    expect(junior).toContain("watercolour");
    expect(senior).toContain("concept art");
    for (const p of [junior, senior]) {
      expect(p).toContain("golden-tipped tail");
      expect(p).not.toContain("Zara");
    }
    const robot = imagePrompt(buildContext({ ...EMBER_ANSWERS, heroType: "robot", aspiration: "be an astronaut" }), "x");
    expect(robot).toContain("porthole eye");
    expect(robot).toContain("space helmet");
  });
  it("the look the child picked changes the picture style (all three), toned for the mode", () => {
    const look = (comicVibe: string, mode: "junior" | "senior" = "junior") => imagePrompt(buildContext({ ...EMBER_ANSWERS, comicVibe, mode }), "x");
    expect(look("soft-peaceful")).toContain("gentle pastel colours");
    expect(look("clear-bold")).toContain("bright saturated colours");
    expect(look("indie-graphic-novel")).toContain("graphic novel");
    expect(look("clear-bold")).toContain("ages 8 to 11");
    expect(look("clear-bold", "senior")).toContain("ages 12 to 14");
    // Three different looks, and none of them the old one-style-per-mode line.
    expect(new Set(["soft-peaceful", "clear-bold", "indie-graphic-novel"].map((v) => look(v))).size).toBe(3);
    expect(look("clear-bold")).not.toContain("watercolour sketch");
    // Nothing picked (older drafts): the mode's default, as before.
    expect(imagePrompt(buildContext({ ...EMBER_ANSWERS, comicVibe: null }), "x")).toContain("watercolour");
  });
  it("the Scene Director chain: Visual Brief row, else Universal Triumph", () => {
    expect(sceneFallback("finale", zara)).toEqual({ text: expect.stringContaining("the clinic"), source: "visual_brief" });
    expect(sceneFallback("finale", zara, {})).toEqual({ text: UNIVERSAL_TRIUMPH, source: "universal_triumph" });
    expect(sceneFallback(undefined, zara)).toEqual({ text: UNIVERSAL_TRIUMPH, source: "universal_triumph" });
  });
  it("the AI's scene is used only if it's a sensible length, with no name in it", () => {
    expect(readScene(`${STAND_IN} hugs a puppy in the clinic`)).toBe("the hero hugs a puppy in the clinic");
    expect(readScene("ok")).toBeNull();
    expect(readScene("x".repeat(500))).toBeNull();
  });
});

describe("picture storage", () => {
  it("keys look like stories/<id>/panel-03.png and can't leave the storage folder", () => {
    expect(panelImageKey("665f1c2ab0d4e1a2b3c4d5e6", 3, "png")).toBe("stories/665f1c2ab0d4e1a2b3c4d5e6/panel-03.png");
    for (const bad of ["../etc/passwd", "stories/../../x.png", "/stories/a.png", "stories", "https://fal.media/x.png"]) {
      expect(isSafeKey(bad)).toBe(false);
    }
  });
  it("a local link works until it expires, and only for its own picture", async () => {
    const storage = getStorage();
    expect(storage.kind).toBe("local");
    const key = "stories/665f1c2ab0d4e1a2b3c4d5e6/panel-01.png";
    await storage.save(key, new Uint8Array([1, 2, 3]), "image/png");
    const link = new URL((await storage.link(key)).url);
    const expires = link.searchParams.get("expires")!;
    const sig = link.searchParams.get("sig")!;
    expect(await readSignedLocal(key, expires, sig)).toMatchObject({ contentType: "image/png" });
    expect(await readSignedLocal(key, String(Number(expires) + 1), sig)).toBeNull(); // changed time
    expect(await readSignedLocal(key.replace("01", "02"), expires, sig)).toBeNull(); // another picture
    expect(await readSignedLocal(key, "1000", sig)).toBeNull(); // long expired
  });
  it("an S3 link is signed for the UAE bucket and expires", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLEONLY";
    process.env.AWS_SECRET_ACCESS_KEY = "not-a-real-secret";
    const link = await s3Storage("dream-builder-test").link("stories/abc/panel-01.png");
    const url = new URL(link.url);
    expect(url.hostname).toContain("dream-builder-test");
    expect(url.hostname).toContain("me-central-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});
