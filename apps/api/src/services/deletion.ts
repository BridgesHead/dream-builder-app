import { isValidObjectId, type Types } from "mongoose";
import { Child, Comment, DeletionRequest, FacilitatorLink, Job, Order, Session, Story, User, type PrintStatus } from "../db/models/index.js";
import { enqueueJob, DELETION_JOB_PREFIX } from "../jobs/queue.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { verifyPassword } from "../lib/password.js";
import { getStorage, storyFolder } from "../lib/storage.js";
import { writeAudit } from "./audit.js";
import { endChildSessions } from "./sessions.js";

// Deleting a child's data on request (guide BE-16).
//
//   preview   what will be deleted, what is kept, and whether a printed book is still printing
//   request   password checked → the child is HIDDEN at once (every API call and link → 404),
//             their sessions end, their story jobs stop → a deletion request + audit entry →
//             the deletion job is queued (jobs/deletionJob.ts does the deleting)
//
// Kept (agreed with Dina, default): audit entries, the parent's consent record, and payment
// records (orders) without the delivery address. None of these hold story content.

export const KEPT = ["Security log entries (no story content)", "Your consent record", "Payment records, without the delivery address"];

// A paid hardback that hasn't shipped yet: the deletion waits for it (BE-16).
const STILL_PRINTING: PrintStatus[] = ["not_ready", "waiting", "file_ready", "sent", "printed", "problem"];

const notFound = () => new AppError(404, "NOT_FOUND", "Child not found");

/** Orders of these stories that are paid hardbacks still being printed. */
export async function printingOrders(storyIds: Types.ObjectId[]): Promise<number> {
  if (storyIds.length === 0) return 0;
  return Order.countDocuments({ storyId: { $in: storyIds }, tier: "hardback", paymentStatus: "paid", printStatus: { $in: STILL_PRINTING } });
}

/** How much a child has, per kind (for the preview, and the before/after counts in tests). */
export async function countChildData(childId: Types.ObjectId | string, storyIds: Types.ObjectId[]) {
  const storage = getStorage();
  let files = 0;
  for (const id of storyIds) files += await storage.countFolder(storyFolder(String(id)));
  return {
    stories: await Story.countDocuments({ _id: { $in: storyIds } }),
    comments: await Comment.countDocuments({ storyId: { $in: storyIds } }),
    jobs: await Job.countDocuments({ storyId: { $in: storyIds } }),
    files,
    sessions: await Session.countDocuments({ childId }),
    facilitatorLinks: await FacilitatorLink.countDocuments({ childId }),
    ordersKept: await Order.countDocuments({ storyId: { $in: storyIds } }),
  };
}

const storyIdsOf = async (childId: Types.ObjectId | string) => (await Story.find({ childId }, { _id: 1 }).lean()).map((s) => s._id);

/** GET /children/:id/deletion-preview: what will go, what stays. */
export async function deletionPreview(parentId: string, childId: string) {
  if (!isValidObjectId(childId)) throw notFound();
  const child = await Child.findOne({ _id: childId, parentId, deletedAt: null }).lean();
  if (!child) throw notFound();
  const storyIds = await storyIdsOf(child._id);
  const counts = await countChildData(child._id, storyIds);
  return {
    child: { id: String(child._id), name: child.name },
    willDelete: { stories: counts.stories, comments: counts.comments, files: counts.files, aiRecords: counts.jobs },
    kept: KEPT,
    // A printed book is on its way: the deletion finishes once it has shipped.
    waitsForPrint: (await printingOrders(storyIds)) > 0,
  };
}

type RequestDoc = NonNullable<Awaited<ReturnType<typeof DeletionRequest.findOne>>>;

/** What the parent sees about a deletion request (ids and counts only). */
export function deletionView(r: Pick<RequestDoc, "status" | "counts" | "createdAt" | "finishedAt" | "childId"> & { _id: unknown }) {
  return {
    id: String(r._id),
    childId: String(r.childId),
    status: r.status,
    counts: r.counts,
    requestedAt: r.createdAt,
    finishedAt: r.finishedAt ?? null,
  };
}

/**
 * POST /children/:id/deletion { password }: starts deleting. The child disappears at once;
 * the rest happens in the background. Asking again while it runs returns the same request.
 */
export async function requestDeletion(parent: { parentId: string; ip?: string | null }, childId: string, password: string) {
  const user = await User.findById(parent.parentId).select("+passwordHash");
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "That password is not right");
  }
  if (!isValidObjectId(childId)) throw notFound();
  // A child hidden by the old "Remove" (before BE-16) can still be fully deleted now.
  const child = await Child.findOne({ _id: childId, parentId: parent.parentId });
  if (!child) throw notFound();

  const open = await DeletionRequest.findOne({ childId: child._id, status: { $ne: "done" } });
  if (open) return { request: deletionView(open), waitsForPrint: open.status === "waiting_for_print" };

  // 1. Hidden straight away: every route treats a hidden child as "not found".
  if (!child.deletedAt) {
    child.deletedAt = new Date();
    await child.save();
  }
  // 2. Any device handed to this child stops working, and no more AI work is done for them.
  const sessions = await Session.countDocuments({ childId: child._id });
  await endChildSessions(child._id);
  const storyIds = await storyIdsOf(child._id);
  await Job.updateMany(
    { storyId: { $in: storyIds }, status: { $in: ["queued", "running"] } },
    { $set: { status: "failed", error: "Stopped: this child's data is being deleted" } },
  );

  // 3. The request, and the audit entry (ids only).
  const request = await DeletionRequest.create({ parentId: parent.parentId, childId: child._id, storyIds, notifyEmail: user.email, counts: { sessions } });
  await writeAudit({ actorId: parent.parentId, actorRole: "parent", action: "child.deletion_request", targetType: "child", targetId: String(child._id), ipAddress: parent.ip });

  // 4. The background job. If the queue is down, the request stays "queued" and the worker
  //    (or the API's start-up check) picks it up later: the child is already hidden.
  try {
    await enqueueJob(`${DELETION_JOB_PREFIX}${String(request._id)}`);
  } catch (err) {
    logger.error({ err, requestId: String(request._id) }, "Could not queue a deletion; it will be picked up later");
  }
  return { request: deletionView(request), waitsForPrint: (await printingOrders(storyIds)) > 0 };
}

/** GET /deletion-requests/:id: one of the caller's requests (404 for anyone else's). */
export async function getDeletionRequest(parentId: string, requestId: string) {
  if (!isValidObjectId(requestId)) throw new AppError(404, "NOT_FOUND", "Not found");
  const request = await DeletionRequest.findOne({ _id: requestId, parentId }).lean();
  if (!request) throw new AppError(404, "NOT_FOUND", "Not found");
  return deletionView(request);
}
