import { AppError } from "../lib/errors.js";
import type { StoryStatus } from "../types/story.js";

// THE one place that decides which story status changes are allowed (guide BE-02).
// Every route, worker or script that changes a story's status must ask here first.
//
//   draft ──► generating ──► child_review ──► parent_review ──► approved
//                                 ▲                 │
//                                 └─────────────────┘  (parent asks for changes)
//
// For each status: where it may go next. Anything not listed is refused.
const ALLOWED_NEXT: Record<StoryStatus, readonly StoryStatus[]> = {
  draft: ["generating"],
  generating: ["child_review"],
  child_review: ["parent_review"], // "I'm done!"
  parent_review: ["approved", "child_review"], // approve, or a change request
  approved: [], // approved locks the story
};

// true if a story may move from `from` to `to`.
export function canChangeStatus(from: StoryStatus, to: StoryStatus): boolean {
  return ALLOWED_NEXT[from].includes(to);
}

// Same check, but throws a 409 INVALID_STATUS_CHANGE error when refused, so a route can
// simply call it and let the errorHandler answer.
export function assertStatusChange(from: StoryStatus, to: StoryStatus): void {
  if (!canChangeStatus(from, to)) {
    throw new AppError(409, "INVALID_STATUS_CHANGE", `A story can't move from "${from}" to "${to}"`);
  }
}
