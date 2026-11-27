import type { Types } from "mongoose";
import { config } from "../config.js";
import { Child, Comment, DeletionRequest, FacilitatorLink, Job, Order, Session, Story } from "../db/models/index.js";
import { logger } from "../lib/logger.js";
import { getStorage, storyFolder } from "../lib/storage.js";
import { writeAudit } from "../services/audit.js";
import { printingOrders } from "../services/deletion.js";
import { sendEmail } from "../services/email.js";
import { DELETION_JOB_PREFIX, enqueueJob, type Attempt } from "./queue.js";

// The deletion job (guide BE-16): removes everything about one child, step by step.
//
//   a paid hardback still printing? → wait (status waiting_for_print), check again later
//   files in storage → AI job records → comments → stories → sessions → facilitator links
//   → payment records: delivery address removed (the records themselves are kept)
//   → the child profile → done + audit entry + confirmation email
//
// Every step deletes "whatever is still there", so running it again is safe: a retry after a
// failed storage delete simply carries on, and the counts add up across tries.

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

function deletionEmail(to: string, backupsGoneBy: Date) {
  const date = backupsGoneBy.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return {
    to,
    subject: "Your child's Dream Builder data has been deleted",
    text: [
      "Hello,",
      "",
      "As you asked, we have deleted your child's profile, stories, pictures, recordings and comments from Dream Builder.",
      "",
      `Our database backups keep copies for ${config.deletion.backupRetentionDays} days, so the last copy will be gone by ${date}. Backups are never used to bring deleted data back into the app.`,
      "",
      "We keep only what we must: security log entries (without any story content), your consent record, and payment records (without the delivery address).",
      "",
      "The Dream Builder team",
    ].join("\n"),
  };
}

/** Runs (or continues) one deletion request. */
export async function runDeletion(requestId: string, { isLastAttempt }: Attempt): Promise<void> {
  const request = await DeletionRequest.findById(requestId);
  if (!request || request.status === "done") return;
  const storyIds = request.storyIds as Types.ObjectId[];

  // A printed book is on its way: wait until it ships (or the order is cancelled), then finish.
  if ((await printingOrders(storyIds)) > 0) {
    const checks = request.printChecks + 1;
    await DeletionRequest.updateOne({ _id: request._id }, { $set: { status: "waiting_for_print", printChecks: checks } });
    await enqueueJob(`${DELETION_JOB_PREFIX}${requestId}`, `${DELETION_JOB_PREFIX}${requestId}-check-${checks}`, { delayMs: config.deletion.printCheckMs });
    logger.info({ requestId, checks }, "Deletion waiting for a printed book to ship");
    return;
  }

  await DeletionRequest.updateOne({ _id: request._id }, { $set: { status: "running" }, $inc: { attempts: 1 } });
  const inc = (field: string, n: number) => (n > 0 ? DeletionRequest.updateOne({ _id: request._id }, { $inc: { [`counts.${field}`]: n } }) : null);

  try {
    // 1. Files first (pictures, redraws, and later voice recordings and print files): if S3
    //    fails here, nothing else is gone yet and the retry starts again from this step.
    const storage = getStorage();
    for (const id of storyIds) await inc("files", await storage.removeFolder(storyFolder(String(id))));

    // 2. Database records, each "whatever is left".
    await inc("jobs", (await Job.deleteMany({ storyId: { $in: storyIds } })).deletedCount);
    await inc("comments", (await Comment.deleteMany({ storyId: { $in: storyIds } })).deletedCount);
    await inc("stories", (await Story.deleteMany({ $or: [{ _id: { $in: storyIds } }, { childId: request.childId }] })).deletedCount);
    await inc("sessions", (await Session.deleteMany({ childId: request.childId })).deletedCount);
    await inc("facilitatorLinks", (await FacilitatorLink.deleteMany({ childId: request.childId })).deletedCount);

    // 3. Payment records are kept, without the delivery address.
    await Order.updateMany({ storyId: { $in: storyIds }, deliveryAddress: { $ne: null } }, { $set: { deliveryAddress: null } });
    // The book PDFs went with the story folder in step 1 (BE-18): the orders stop pointing at them.
    await Order.updateMany({ storyId: { $in: storyIds }, $or: [{ pdfKey: { $ne: null } }, { printFileKey: { $ne: null } }] }, { $set: { pdfKey: null, printFileKey: null, pdfStatus: "deleted" } });
    const ordersKept = await Order.countDocuments({ storyId: { $in: storyIds } });

    // 4. The child profile itself.
    await Child.deleteOne({ _id: request.childId });

    await DeletionRequest.updateOne(
      { _id: request._id },
      { $set: { status: "done", finishedAt: new Date(), lastError: null, "counts.ordersKept": ordersKept } },
    );
    await writeAudit({ actorId: null, actorRole: "system", action: "child.deletion_complete", targetType: "child", targetId: String(request.childId) });
    const backupsGoneBy = new Date(Date.now() + config.deletion.backupRetentionDays * 24 * 3600 * 1000);
    await sendEmail(deletionEmail(request.notifyEmail, backupsGoneBy)).catch((err: unknown) => {
      // The data is gone either way; a missing email is logged, not retried.
      logger.error({ requestId, reason: reasonOf(err) }, "Deletion confirmation email not sent");
    });
    logger.info({ requestId }, "Child data deleted");
  } catch (err) {
    const reason = reasonOf(err);
    logger.warn({ requestId, isLastAttempt, reason }, "Deletion try failed");
    await DeletionRequest.updateOne({ _id: request._id }, { $set: { status: isLastAttempt ? "failed" : "queued", lastError: reason } });
    throw err; // the queue retries
  }
}

/** In-memory queue only (your PC): a restart forgets the list, so put unfinished deletions back. */
export async function recoverDeletions(): Promise<void> {
  const open = await DeletionRequest.find({ status: { $in: ["queued", "running", "waiting_for_print"] } }, { _id: 1 }).lean();
  for (const r of open) await enqueueJob(`${DELETION_JOB_PREFIX}${String(r._id)}`, `${DELETION_JOB_PREFIX}${String(r._id)}-recover-${Date.now()}`);
  if (open.length > 0) logger.info({ count: open.length }, "Put unfinished deletions back on the list");
}
