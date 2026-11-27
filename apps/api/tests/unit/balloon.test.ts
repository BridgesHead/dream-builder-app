import { describe, expect, it } from "vitest";
import { burstPoints, ovalAround, SPIKE_REACH, tailBase } from "../../src/print/balloon.js";

// The comic balloon shapes (src/print/balloon.ts): real ovals and bursts, like a letterer draws.

const inOval = (x: number, y: number, rx: number, ry: number) => (x / rx) ** 2 + (y / ry) ** 2 <= 1 + 1e-9;

describe("comic balloon shapes", () => {
  it("the oval holds every corner of the words", () => {
    for (const [w, h] of [[100, 14], [60, 42], [30, 30], [200, 14]]) {
      const { rx, ry } = ovalAround(w, h);
      expect(inOval(w / 2, h / 2, rx, ry)).toBe(true);
      // Never more than √2 times the box (no huge empty balloons).
      expect(rx).toBeLessThanOrEqual((w / 2) * Math.SQRT2 + 1e-9);
    }
  });

  it("a one-line balloon is an oval, not a flat strip", () => {
    const { rx, ry } = ovalAround(120, 14);
    expect(ry / rx).toBeGreaterThan(0.28);
  });

  it("a burst has its dips on the oval and its points further out", () => {
    const pts = burstPoints(0, 0, 50, 20, 12);
    expect(pts).toHaveLength(24);
    const reach = pts.map(([x, y]) => Math.sqrt((x / 50) ** 2 + (y / 20) ** 2));
    expect(Math.max(...reach)).toBeCloseTo(SPIKE_REACH, 5);
    expect(Math.min(...reach)).toBeCloseTo(1, 5);
  });

  it("the tail leaves the oval facing the speaker, its base just inside the outline", () => {
    const [a, b, edge] = tailBase(0, 0, 50, 20, [30, 60]);
    expect(inOval(...a, 50, 20)).toBe(true);
    expect(inOval(...b, 50, 20)).toBe(true);
    // The edge point is on the oval, on the speaker's side (below, to the right).
    expect((edge[0] / 50) ** 2 + (edge[1] / 20) ** 2).toBeCloseTo(1, 5);
    expect(edge[0]).toBeGreaterThan(0);
    expect(edge[1]).toBeGreaterThan(0);
  });
});
