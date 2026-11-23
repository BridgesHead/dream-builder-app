// BE-08 story draft rules, on their own (no database).
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import {
  changesForSave,
  type DraftAnswers,
  missingSteps,
  modeProblems,
  normaliseOneMoreAmazingThing,
  pathFor,
} from "../../src/services/storyRules.js";
import { StoryPatchSchema } from "../../src/types/story.js";

// A finished two-act Explorer draft.
const COMPLETE_EXPLORER: DraftAnswers = {
  authorName: "Alex",
  selectedFormat: "storybook",
  comicVibe: "soft-peaceful",
  heroType: "fox",
  heroPronoun: "she",
  charStrengths: ["kind-heart"],
  aspiration: "be a vet",
  obstacles: ["grumpy-giant"],
  heartColor: "jumpy",
  braveMove: "ask-for-help",
  heroWords: "I can start with one small step.",
  safePlaceText: "the tree house",
  obstacles2: ["glass-wall"],
  heartColor2: "foggy",
  braveMove2: "lead-the-way",
  heroWords2: "I'll try another way.",
  facesChallenge3: false,
  obstacles3: [],
  heartColor3: "",
  braveMove3: "",
  heroWords3: "",
};

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected an AppError");
}

describe("the request shape (StoryPatchSchema)", () => {
  it("refuses a 'they' pronoun", () => {
    expect(StoryPatchSchema.safeParse({ heroPronoun: "they" }).success).toBe(false);
  });
  it("refuses answers that aren't real option ids", () => {
    expect(StoryPatchSchema.safeParse({ obstacles: ["dragon"] }).success).toBe(false);
    expect(StoryPatchSchema.safeParse({ braveMove2: "run-away" }).success).toBe(false);
  });
  it("refuses fields the server controls, and unknown fields", () => {
    for (const body of [{ status: "approved" }, { storyPath: "three_act" }, { childId: "x" }, { mode: "senior" }, { confirmedByChild: true }]) {
      expect(StoryPatchSchema.safeParse(body).success).toBe(false);
    }
  });
  it("refuses an empty save", () => {
    expect(StoryPatchSchema.safeParse({}).success).toBe(false);
  });
  it("accepts a normal step, and '' for 'not chosen yet'", () => {
    expect(StoryPatchSchema.safeParse({ obstacles: ["roaring-fire"], heartColor: "steady" }).success).toBe(true);
    expect(StoryPatchSchema.safeParse({ heartColor: "" }).success).toBe(true);
  });
});

describe("mode rules", () => {
  it("refuses Creator-only answers on an Explorer draft", () => {
    expect(Object.keys(modeProblems("junior", { charStrengths: ["resilient"] }))).toEqual(["charStrengths"]);
    expect(Object.keys(modeProblems("junior", { heartColor3: "burning" }))).toEqual(["heartColor3"]);
  });
  it("refuses Explorer answers on a Creator draft", () => {
    expect(Object.keys(modeProblems("senior", { charStrengths: ["kind-heart"] }))).toEqual(["charStrengths"]);
    // Creator's final act has its own feelings list.
    expect(Object.keys(modeProblems("senior", { heartColor3: "jumpy" }))).toEqual(["heartColor3"]);
  });
  it("accepts each mode's own answers", () => {
    expect(modeProblems("junior", { charStrengths: ["kind-heart"], heartColor3: "jumpy" })).toEqual({});
    expect(modeProblems("senior", { charStrengths: ["resilient"], heartColor: "jumpy", heartColor3: "burning" })).toEqual({});
  });
});

describe("oneMoreAmazingThing (defect 8)", () => {
  it("trims, uses single spaces and drops trailing full stops", () => {
    expect(normaliseOneMoreAmazingThing("  she can   juggle..  ")).toBe("she can juggle");
    expect(normaliseOneMoreAmazingThing("sings")).toBe("sings");
  });
  it("is applied on save", () => {
    expect(changesForSave("junior", { facesChallenge3: null }, { oneMoreAmazingThing: " flies  kites. " }).oneMoreAmazingThing).toBe("flies kites");
  });
});

describe("the Challenge Gate", () => {
  it("sets storyPath from the answer", () => {
    expect(pathFor(true)).toBe("three_act");
    expect(pathFor(false)).toBe("two_act");
    expect(pathFor(null)).toBeNull();
    expect(changesForSave("junior", { facesChallenge3: null }, { facesChallenge3: true }).storyPath).toBe("three_act");
  });
  it("choosing two acts clears every third-act field", () => {
    const changes = changesForSave("junior", { facesChallenge3: true }, { facesChallenge3: false });
    expect(changes).toMatchObject({ storyPath: "two_act", obstacles3: [], heartColor3: "", braveMove3: "", heroWords3: "", thirdChallengeText: "" });
  });
  it("a two-act story can't be given third-act answers", () => {
    const err = errorOf(() => changesForSave("junior", { facesChallenge3: false }, { obstacles3: ["grumpy-giant"] }));
    expect(err.status).toBe(400);
    expect(Object.keys(err.fields!)).toEqual(["obstacles3"]);
  });
  it("but empty third-act values are fine", () => {
    expect(() => changesForSave("junior", { facesChallenge3: false }, { heroWords3: "" })).not.toThrow();
  });
});

describe("missingSteps (defect 2)", () => {
  it("a complete two-act draft has nothing missing", () => {
    expect(missingSteps("junior", COMPLETE_EXPLORER)).toEqual([]);
  });
  it("an empty Explorer draft lists every step, in wizard order", () => {
    const empty: DraftAnswers = {
      ...COMPLETE_EXPLORER,
      authorName: "", selectedFormat: null, comicVibe: null, heroType: null, heroPronoun: null, charStrengths: [],
      aspiration: "", obstacles: [], heartColor: "", braveMove: "", heroWords: "", safePlaceText: "",
      obstacles2: [], heartColor2: "", braveMove2: "", heroWords2: "", facesChallenge3: null,
    };
    expect(missingSteps("junior", empty)).toEqual([
      "author", "format", "style", "hero", "heroName", "strength", "dream",
      "act1.obstacle", "act1.feeling", "act1.move", "rest", "act2.obstacle", "act2.feeling", "act2.move", "gate",
    ]);
    // Creator answers each act on one screen.
    expect(missingSteps("senior", empty)).toEqual(["author", "format", "style", "hero", "strength", "dream", "act1", "rest", "act2", "gate"]);
  });
  it("three acts also need the whole third act", () => {
    expect(missingSteps("junior", { ...COMPLETE_EXPLORER, facesChallenge3: true })).toEqual(["act3.obstacle", "act3.feeling", "act3.move"]);
  });
  it("blank words don't count as an answer", () => {
    expect(missingSteps("junior", { ...COMPLETE_EXPLORER, heroWords: "   " })).toEqual(["act1.move"]);
  });
});
