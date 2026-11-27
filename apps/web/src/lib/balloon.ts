// The shapes of a comic balloon (FE-07), as a comic letterer draws them. A COPY of the API's
// apps/api/src/print/balloon.ts, so the website (ComicCell.tsx) and the printed book
// (renderBook.ts) draw exactly the same balloons. Change both together.
//
//   ovalAround    the oval that holds a box of words (speech, thought and whisper all use it)
//   burstPoints   the spiky burst around that oval (shout)
//   tailBase      where the tail leaves the oval, aimed at a point (the speaker)

export type Point = [number, number];

/** How far a burst's points reach past its oval (1.25 = a quarter further out). */
export const SPIKE_REACH = 1.25;

/**
 * The oval around a w × h box of words. The words' corners sit just inside it. A one-line
 * balloon isn't squashed flat: its height is at least about a third of its width, like a
 * hand-lettered balloon.
 */
export function ovalAround(w: number, h: number): { rx: number; ry: number } {
  const a = w / 2;
  const b = h / 2;
  const ry = Math.max(b * Math.SQRT2, a * 0.32);
  // The oval through the box's corners for this height (ry ≥ b√2 keeps rx ≤ a√2).
  const rx = a / Math.sqrt(1 - (b / ry) ** 2);
  return { rx, ry };
}

/** The points of a spiky burst around the oval: n spikes, with the dips on the oval itself. */
export function burstPoints(cx: number, cy: number, rx: number, ry: number, n: number): Point[] {
  const pts: Point[] = [];
  for (let k = 0; k < n * 2; k += 1) {
    // A small turn so a spike doesn't sit exactly on top, where it looks like a party hat.
    const angle = (k / (n * 2)) * Math.PI * 2 + Math.PI / (n * 2);
    const out = k % 2 === 0 ? SPIKE_REACH : 1;
    pts.push([cx + Math.cos(angle) * rx * out, cy + Math.sin(angle) * ry * out]);
  }
  return pts;
}

/**
 * Where the tail meets the oval when it points at `tip`: its two base corners (a little inside
 * the oval, `inset` < 1, so the white tail covers the outline where they join) and the point on
 * the oval's edge facing the tip.
 */
export function tailBase(cx: number, cy: number, rx: number, ry: number, tip: Point, inset = 0.92): [Point, Point, Point] {
  // The direction to the tip, measured on the oval (so the tail is centred on the oval's edge).
  const theta = Math.atan2((tip[1] - cy) / ry, (tip[0] - cx) / rx);
  const spread = 0.22; // half the tail's width, as an angle round the oval
  const at = (t: number, scale: number): Point => [cx + Math.cos(t) * rx * scale, cy + Math.sin(t) * ry * scale];
  return [at(theta - spread, inset), at(theta + spread, inset), at(theta, 1)];
}
