import { describe, expect, it } from "vitest";
import { cellPictureRatio, COMIC_FRAMES, LAYOUTS } from "../../src/engine/comicPlan.js";
import { pictureSize, scaleToFit, STORY_PICTURE_RATIO } from "../../src/engine/visual.js";

// Pictures are made in the shape they're printed in, big enough to print (engine/visual.ts).

describe("picture sizes", () => {
  it("the storybook picture is 16:10, 2048 px wide", () => {
    expect(pictureSize(STORY_PICTURE_RATIO, 2048)).toEqual({ width: 2048, height: 1280 });
  });

  it("a tall picture keeps its long side up and down", () => {
    expect(pictureSize(0.5, 2048)).toEqual({ width: 1024, height: 2048 });
  });

  it("sizes are steps of 32 px, never thinner than 512", () => {
    for (const ratio of [0.34, 0.61, 0.8, 1, 1.43, 1.6, 3]) {
      const { width, height } = pictureSize(ratio, 2048);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(512);
    }
  });

  it("shrinking to a service's limit keeps the shape", () => {
    const small = scaleToFit({ width: 2048, height: 1280 }, 1920);
    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(1920);
    expect(small.width / small.height).toBeCloseTo(1.6, 1);
    // Already small enough: unchanged (never grown).
    expect(scaleToFit({ width: 1024, height: 768 }, 1920)).toEqual({ width: 1024, height: 768 });
  });

  it("each comic panel's picture has its frame's shape on the page", () => {
    // big_top: one wide panel on top, three tall ones under it.
    expect(cellPictureRatio("big_top", 1)).toBeGreaterThan(1.3);
    for (const cell of [2, 3, 4]) expect(cellPictureRatio("big_top", cell)).toBeLessThan(0.7);
    // tall: the first panel runs the full height of the page.
    expect(cellPictureRatio("tall", 1)).toBeLessThan(0.4);
    // Every layout has 4 frames, and an unknown layout falls back to the grid.
    for (const layout of LAYOUTS) expect(COMIC_FRAMES[layout]).toHaveLength(4);
    expect(cellPictureRatio(null, 1)).toBe(cellPictureRatio("grid", 1));
  });
});
