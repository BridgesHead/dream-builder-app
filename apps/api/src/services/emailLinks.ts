import type { Types } from "mongoose";
import { EmailLink, type EmailLinkPurpose } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { createRandomToken, hashToken } from "../lib/randomToken.js";

// Single-use links for emails (guide BE-03): they work ONCE, and not after 24 hours.

const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

// Makes a new link token and returns it (to put in the email). Any older unused link for the
// same thing stops working, so only the newest email's link is valid.
export async function createEmailLink(userId: Types.ObjectId | string, purpose: EmailLinkPurpose): Promise<string> {
  const now = new Date();
  await EmailLink.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: now } });

  const token = createRandomToken();
  await EmailLink.create({ userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS) });
  return token;
}

// Uses a link: returns the user id, or throws a clear error. After this, the link is spent.
export async function useEmailLink(token: string, purpose: EmailLinkPurpose): Promise<string> {
  const link = await EmailLink.findOne({ tokenHash: hashToken(token), purpose }).lean();

  if (!link) throw new AppError(400, "LINK_INVALID", "This link is not valid. Please request a new one.");
  if (link.usedAt) throw new AppError(400, "LINK_USED", "This link has already been used. Please request a new one.");
  if (link.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, "LINK_EXPIRED", "This link has expired (links last 24 hours). Please request a new one.");
  }

  // Mark it used in ONE step that also checks it's still unused. If two clicks arrive at the
  // same moment, only one can win; the other sees null and gets "already used".
  const claimed = await EmailLink.findOneAndUpdate({ _id: link._id, usedAt: null }, { $set: { usedAt: new Date() } });
  if (!claimed) throw new AppError(400, "LINK_USED", "This link has already been used. Please request a new one.");

  return String(link.userId);
}
