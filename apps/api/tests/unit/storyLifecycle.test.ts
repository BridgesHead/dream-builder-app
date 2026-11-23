// Guide BE-02: "One shared function allows or refuses each status change, with a unit test
// for every allowed and every refused change." 5 statuses x 5 = 25 pairs, all tested.
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { assertStatusChange, canChangeStatus } from "../../src/services/storyLifecycle.js";
import { STORY_STATUSES, type StoryStatus } from "../../src/types/story.js";

const ALLOWED: [StoryStatus, StoryStatus][] = [
  ["draft", "generating"],
  ["generating", "child_review"],
  ["child_review", "parent_review"],
  ["parent_review", "approved"],
  ["parent_review", "child_review"],
];

const isAllowed = (from: StoryStatus, to: StoryStatus) => ALLOWED.some(([f, t]) => f === from && t === to);

// Every pair that is NOT in the allowed list, including "same to same".
const REFUSED = STORY_STATUSES.flatMap((from) =>
  STORY_STATUSES.filter((to) => !isAllowed(from, to)).map((to) => [from, to] as [StoryStatus, StoryStatus]),
);

describe("story status changes", () => {
  it("covers all 25 pairs: 5 allowed + 20 refused", () => {
    expect(ALLOWED.length + REFUSED.length).toBe(25);
    expect(REFUSED.length).toBe(20);
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canChangeStatus(from, to)).toBe(true);
    expect(() => assertStatusChange(from, to)).not.toThrow();
  });

  it.each(REFUSED)("refuses %s -> %s", (from, to) => {
    expect(canChangeStatus(from, to)).toBe(false);
    try {
      assertStatusChange(from, to);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(409);
      expect((err as AppError).code).toBe("INVALID_STATUS_CHANGE");
    }
  });
});
