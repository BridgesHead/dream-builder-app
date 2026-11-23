// BE-12: the checks on a sentence from the Creator-mode rewriter (pure logic).
import { describe, expect, it } from "vitest";
import { cleanRewrite, rewriteProblems } from "../../src/engine/index.js";

const ORIGINAL = "Ember walked through the meadow.";

describe("rewriteProblems", () => {
  it("accepts one fresh sentence within the limit", () => {
    expect(rewriteProblems("Ember wandered slowly across the sunny meadow.", ORIGINAL, 25)).toEqual([]);
  });

  it("refuses two sentences, too many words, or the same sentence back", () => {
    expect(rewriteProblems("Ember ran. She smiled.", ORIGINAL, 25)).toContain("is not exactly one sentence");
    expect(rewriteProblems("Ember walked and walked and walked across the very wide meadow.", ORIGINAL, 5)).toContain("has 11 words (at most 5)");
    expect(rewriteProblems("ember walked through the meadow!", ORIGINAL, 25)).toContain("is the same as the original");
    expect(rewriteProblems("", ORIGINAL, 25)).toEqual(["is empty"]);
  });

  it("keeps the story's tone: no clinical words, no magic fixes, no vanishing obstacles", () => {
    expect(rewriteProblems("Ember felt her anxiety in the meadow.", ORIGINAL, 25)).toContain("uses a clinical word");
    expect(rewriteProblems("Ember waved a magic wand over the meadow.", ORIGINAL, 25)).toContain("uses magic to fix the problem");
    expect(rewriteProblems("The giant vanished from the meadow.", ORIGINAL, 25)).toContain("makes the obstacle disappear");
  });

  it("lets the child keep a word they used themselves", () => {
    expect(rewriteProblems("Suddenly Ember ran across the meadow.", "Suddenly Ember walked through the meadow.", 25)).toEqual([]);
  });

  it("gives the same answer every time (no leftover regex state)", () => {
    for (let i = 0; i < 3; i += 1) expect(rewriteProblems("The giant vanished.", ORIGINAL, 25)).toEqual(["makes the obstacle disappear"]);
  });
});

describe("cleanRewrite", () => {
  it("drops quotes, chatter and extra lines", () => {
    expect(cleanRewrite('"Ember ran on."')).toBe("Ember ran on.");
    expect(cleanRewrite("Here is a new sentence: Ember ran on.")).toBe("Ember ran on.");
    expect(cleanRewrite("Ember ran\non.")).toBe("Ember ran on.");
  });
});
