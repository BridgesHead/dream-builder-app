import type { Response } from "express";
import { Child, User } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { ACCESS_TOKEN_SECONDS, createAccessToken, createChildAccessToken } from "./accessTokens.js";
import { writeAudit } from "./audit.js";
import { getChild, toPublicChild, type PublicChild } from "./children.js";
import { endSession, endSessionById, startChildSession, startSession } from "./sessions.js";
import { toPublicUser, type PublicUser } from "./users.js";

// Child sessions (guide BE-04), like swapping wristbands at a theme park:
//   handover: the parent's wristband is cut off and the child gets a kids' wristband.
//   exit:     the parent shows their ID (password) to swap back.

export interface ChildSessionBody {
  kind: "child";
  child: PublicChild;
  accessToken: string;
  expiresIn: number;
}

export interface ParentSessionBody {
  kind: "parent";
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}

export async function parentSessionBody(user: PublicUser): Promise<ParentSessionBody> {
  return { kind: "parent", user, accessToken: await createAccessToken(user.id, user.role), expiresIn: ACCESS_TOKEN_SECONDS };
}

async function childSessionBody(parentId: string, child: PublicChild, sessionId: string): Promise<ChildSessionBody> {
  return {
    kind: "child",
    child,
    accessToken: await createChildAccessToken(parentId, child.id, sessionId),
    expiresIn: ACCESS_TOKEN_SECONDS,
  };
}

// The parent picked a child and tapped "Hand Device & Begin".
export async function handOver(
  res: Response,
  parentId: string,
  childId: string,
  parentRefreshToken: string | null,
  ip?: string,
): Promise<ChildSessionBody> {
  // 404 if it's not this parent's child (or it was removed).
  const child = await getChild(parentId, childId);

  // End the parent's own session on this device. Otherwise the parent's refresh cookie would
  // still work, and the child could get a parent wristband back without any password.
  if (parentRefreshToken) await endSession(parentRefreshToken);
  const sessionId = await startChildSession(res, parentId, child.id);

  await writeAudit({ actorId: parentId, actorRole: "parent", action: "child_session.start", targetType: "child", targetId: child.id, ipAddress: ip });
  return childSessionBody(parentId, child, sessionId);
}

// The parent typed their password to leave the child session.
export async function exitWithPassword(
  res: Response,
  session: { sessionId: string; childId: string; parentId: string },
  password: string,
  ip?: string,
): Promise<ParentSessionBody> {
  const parent = await User.findById(session.parentId).select("+passwordHash");
  if (!parent || !(await verifyPassword(parent.passwordHash, password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "That password is not right");
  }

  await endSessionById(session.sessionId);
  // A fresh parent session, not remembered: the parent can tick "remember me" next login.
  await startSession(res, parent._id, false);

  await writeAudit({ actorId: session.parentId, actorRole: "parent", action: "child_session.exit", targetType: "child", targetId: session.childId, ipAddress: ip });
  return parentSessionBody(toPublicUser(parent));
}

// /auth/refresh with a child refresh cookie: a new kids' wristband, if the child is still there.
export async function refreshChildSession(parentId: string, childId: string, sessionId: string): Promise<ChildSessionBody | null> {
  const child = await Child.findOne({ _id: childId, parentId, deletedAt: null }).lean();
  if (!child) return null;
  return childSessionBody(parentId, toPublicChild(child), sessionId);
}
