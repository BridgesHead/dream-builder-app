import type { Mode } from "../types/story.js";

// The default mode for a child's age: under 12 is Explorer ("junior"), 12 and over is
// Creator ("senior"). Same rule as modeForAge in the frontend's AppState.tsx.
// It is only a default: the parent may pick the other mode, and their choice is stored.
export function modeForAge(age: number): Mode {
  return age < 12 ? "junior" : "senior";
}
