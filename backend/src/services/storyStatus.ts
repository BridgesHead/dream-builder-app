import { Story } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import type { StoryStatus } from "../types/story.js";
import { writeAudit, type AuditAction, type AuditEntry } from "./audit.js";
import { assertStatusChange } from "./storyLifecycle.js";

// THE way to change a story's status (guide BE-12). Every status change goes through here:
//
//   1. storyLifecycle says whether the change is allowed (409 if not),
//   2. the change is saved ONLY if the story is still in the old status, so two taps at the
//      same moment (or two jobs finishing together) can't both do it,
//   3. an audit entry says who did it, to which story, and from where (BE-05).

/** Who changed the status, as the audit log records it. */
export type StatusActor =
  | { role: "child_session"; parentId: string } // a child on the parent's device (audited as the parent's account)
  | { role: "parent"; parentId: string }
  | { role: "system" }; // a worker, when the AI has finished

// One audit action per arrow of the lifecycle.
const ACTION_FOR: Record<string, AuditAction> = {
  "draft>generating": "story.generate",
  "generating>child_review": "story.ready",
  "child_review>parent_review": "story.submit",
  "parent_review>child_review": "story.request_changes",
  "parent_review>approved": "story.approve",
};

export interface StatusChange {
  storyId: string;
  from: StoryStatus;
  to: StoryStatus;
  actor: StatusActor;
  ipAddress?: string | null;
  /** Other fields to save in the same write, e.g. { approvedAt: new Date() }. */
  alsoSet?: Record<string, unknown>;
}

/**
 * Moves the story from `from` to `to`. Returns false (and changes nothing) when the story
 * wasn't in `from` any more, e.g. another tap already moved it.
 * Throws 409 INVALID_STATUS_CHANGE when the lifecycle doesn't allow this arrow at all.
 */
export async function changeStoryStatus(change: StatusChange): Promise<boolean> {
  assertStatusChange(change.from, change.to);
  const moved = await Story.updateOne(
    { _id: change.storyId, status: change.from },
    { $set: { ...change.alsoSet, status: change.to } },
  );
  if (moved.modifiedCount === 0) return false;
  await auditStatus(change.storyId, ACTION_FOR[`${change.from}>${change.to}`], change.actor, change.ipAddress);
  return true;
}

/** Same, but a story that already moved on is a 409 for the caller. */
export async function requireStatusChange(change: StatusChange, message: string): Promise<void> {
  if (!(await changeStoryStatus(change))) throw new AppError(409, "STORY_LOCKED", message);
}

/** The audit entry for a status change (also used for the one undo: generating → draft). */
export async function auditStatus(storyId: string, action: AuditAction, actor: StatusActor, ipAddress?: string | null): Promise<void> {
  const entry: AuditEntry =
    actor.role === "system"
      ? { actorId: null, actorRole: "system", action, targetType: "story", targetId: storyId }
      : { actorId: actor.parentId, actorRole: actor.role, action, targetType: "story", targetId: storyId, ipAddress };
  await writeAudit(entry);
}
