import { isValidObjectId } from "mongoose";
import { AuditLog } from "../db/models/index.js";

// The security diary (guide BE-05). The guide's list, and the action name each one writes:
//   sign-ins                      auth.sign_in
//   consent                       consent.record
//   child profile changes         child.create, child.update, child.delete
//   child sessions (BE-04)        child_session.start, child_session.exit
//   facilitator and admin views   story.view
//   role changes                  user.create, user.role_change, facilitator.link, facilitator.unlink
//   story approvals               story.approve (the approve route comes with BE-12)
// Each entry: who did it, what, to which record, and from which IP. "When" is createdAt.
// NEVER put story text, passwords or tokens in here.
//
// Entries can only be ADDED. The model refuses every change and delete, and no API route
// changes or deletes one (the admin route only reads them).

export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "consent.record",
  "child.create",
  "child.update",
  "child.delete",
  "child_session.start",
  "child_session.exit",
  "story.view",
  // Every story status change (BE-12), one action per arrow of the lifecycle:
  "story.generate", //         draft → generating
  "story.generate_undo", //    generating → draft (the queue couldn't take the jobs)
  "story.ready", //            generating → child_review
  "story.submit", //           child_review → parent_review ("I'm done!")
  "story.request_changes", //  parent_review → child_review
  "story.approve", //          parent_review → approved
  // Orders (BE-17)
  "order.create", //   the parent started checkout
  "order.paid", //     Stripe confirmed the payment (the webhook)
  "user.create",
  "user.role_change",
  "facilitator.link",
  "facilitator.unlink",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  // null when the actor is the system (a command-line script).
  actorId: string | null;
  actorRole: "parent" | "child_session" | "facilitator" | "admin" | "system";
  action: AuditAction;
  targetType: "user" | "consent" | "child" | "story" | "facilitator_link" | "order";
  targetId: string;
  ipAddress?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await AuditLog.create({ ...entry, ipAddress: entry.ipAddress ?? null });
}

export interface AuditQuery {
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  // Newest first. "before" = an entry id: the next page starts after it.
  before?: string;
  limit: number;
}

// For the admin route: read only.
export async function listAudit(query: AuditQuery) {
  const filter: Record<string, unknown> = {};
  if (query.actorId) {
    if (!isValidObjectId(query.actorId)) return [];
    filter.actorId = query.actorId;
  }
  if (query.targetType) filter.targetType = query.targetType;
  if (query.targetId) filter.targetId = query.targetId;
  if (query.action) filter.action = query.action;
  if (query.before) {
    if (!isValidObjectId(query.before)) return [];
    filter._id = { $lt: query.before };
  }
  // Sorting by _id = by creation time (MongoDB ids start with a timestamp).
  const entries = await AuditLog.find(filter).sort({ _id: -1 }).limit(query.limit).lean();
  return entries.map((e) => ({
    id: String(e._id),
    actorId: e.actorId ? String(e.actorId) : null,
    actorRole: e.actorRole,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    ipAddress: e.ipAddress,
    createdAt: e.createdAt,
  }));
}
