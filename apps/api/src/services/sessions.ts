import type { CookieOptions, Request, Response } from "express";
import type { Types } from "mongoose";
import { config } from "../config.js";
import { Session } from "../db/models/index.js";
import { createRandomToken, hashToken } from "../lib/randomToken.js";

// Refresh tokens (the "membership card"): a random token in an httpOnly cookie, with its
// hash in the sessions collection.

export const REFRESH_COOKIE = "db_refresh";

const DAY_MS = 24 * 60 * 60 * 1000;
// "Remember me" ticked: 30 days. Not ticked: the cookie ends when the browser closes,
// and the server stops accepting it after 1 day at the latest.
const REMEMBER_MS = 30 * DAY_MS;
const SHORT_MS = 1 * DAY_MS;
// A child session (BE-04): the cookie ends when the browser closes, and the server stops
// accepting it after 12 hours at the latest.
const CHILD_MS = 12 * 60 * 60 * 1000;

const cookieOptions: CookieOptions = {
  // Page JavaScript can't read the cookie, so a script injected into the page can't steal it.
  httpOnly: true,
  // Sent only over HTTPS. Your PC runs plain http://localhost, so it is off in development
  // and tests, and on everywhere else (dev, staging, production on AWS).
  secure: config.isProduction,
  // Not sent when another website makes the request, which blocks cross-site tricks (CSRF).
  sameSite: "strict",
  // Sent only to the auth routes, not with every API call.
  path: "/api/v1/auth",
};

// Starts a new login: makes a refresh token, stores its hash, and sets the cookie.
export async function startSession(res: Response, userId: Types.ObjectId | string, remember: boolean): Promise<void> {
  const token = createRandomToken();
  const lifetime = remember ? REMEMBER_MS : SHORT_MS;
  await Session.create({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + lifetime), remember });

  // maxAge makes the browser keep the cookie after it closes. Without it, it's a
  // "session cookie" that disappears when the browser closes.
  res.cookie(REFRESH_COOKIE, token, remember ? { ...cookieOptions, maxAge: lifetime } : cookieOptions);
}

export function readRefreshCookie(req: Request): string | null {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof token === "string" && token !== "" ? token : null;
}

export type SessionCheck =
  | { ok: true; userId: string; sessionId: string; childId: string | null }
  | { ok: false; reason: "expired" | "invalid" };

// Is this refresh token one of ours, and still valid?
export async function checkSession(token: string): Promise<SessionCheck> {
  const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session) return { ok: false, reason: "invalid" };
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id });
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    userId: String(session.userId),
    sessionId: String(session._id),
    childId: session.childId ? String(session.childId) : null,
  };
}

// The parent handed the device to a child (BE-04). Sets a CHILD refresh cookie in place of the
// parent's one (same cookie name, so the browser overwrites it) and returns the session id.
export async function startChildSession(
  res: Response,
  parentId: Types.ObjectId | string,
  childId: Types.ObjectId | string,
): Promise<string> {
  const token = createRandomToken();
  const session = await Session.create({
    userId: parentId,
    childId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + CHILD_MS),
    remember: false,
  });
  // No maxAge: a browser-session cookie.
  res.cookie(REFRESH_COOKIE, token, cookieOptions);
  return String(session._id);
}

// Is this child session still open? Used on every request made with a child wristband.
export async function childSessionIsOpen(sessionId: string, childId: string): Promise<boolean> {
  const session = await Session.findOne({ _id: sessionId, childId }).lean();
  return !!session && session.expiresAt.getTime() > Date.now();
}

export async function endSessionById(sessionId: string): Promise<void> {
  await Session.deleteOne({ _id: sessionId });
}

// The child was removed: every session handed to them stops working.
export async function endChildSessions(childId: Types.ObjectId | string): Promise<void> {
  await Session.deleteMany({ childId });
}

// Log out this device.
export async function endSession(token: string): Promise<void> {
  await Session.deleteOne({ tokenHash: hashToken(token) });
}

// Log out every device of this user (after a password reset).
export async function endAllSessions(userId: Types.ObjectId | string): Promise<void> {
  await Session.deleteMany({ userId });
}

// The browser only deletes a cookie when path, sameSite, ... match the ones it was set with.
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}
