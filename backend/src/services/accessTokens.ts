import { errors, jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import type { UserRole } from "../db/models/index.js";

// The access token (the 15-minute "wristband") is a JWT: a small piece of signed JSON,
//   { sub: "<user id>", role: "parent", exp: <when it expires>, ... }
// signed with JWT_ACCESS_SECRET. Anyone can READ a JWT, but nobody can CHANGE one or make
// a new one without the secret, because the signature would no longer match.
// So: never put anything private inside it. We only put ids and the role.
//
// Two kinds (BE-04):
//   parent wristband: { sub: parentId, role: "parent" }
//   kids' wristband:  { sub: parentId, role: "child_session", childId, sid: sessionId }
// sid lets the server check the child session still exists, so ending it (exit, or the
// child being removed) stops the wristband straight away, not 15 minutes later.

export const ACCESS_TOKEN_SECONDS = 15 * 60;

const ISSUER = "dream-builder-api";
const AUDIENCE = "dream-builder";
const key = new TextEncoder().encode(config.jwtAccessSecret);

export type TokenRole = UserRole | "child_session";

function sign(claims: Record<string, string>, subject: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(key);
}

export function createAccessToken(userId: string, role: UserRole): Promise<string> {
  return sign({ role }, userId);
}

export function createChildAccessToken(parentId: string, childId: string, sessionId: string): Promise<string> {
  return sign({ role: "child_session", childId, sid: sessionId }, parentId);
}

export type AccessTokenCheck =
  | { ok: true; userId: string; role: TokenRole; childId?: string; sessionId?: string }
  | { ok: false; reason: "expired" | "invalid" };

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

// Checks the signature, who made it, who it's for, and that it hasn't expired.
export async function checkAccessToken(token: string): Promise<AccessTokenCheck> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    const userId = str(payload.sub);
    const role = str(payload.role) as TokenRole | undefined;
    if (!userId || !role) return { ok: false, reason: "invalid" };

    if (role === "child_session") {
      const childId = str(payload.childId);
      const sessionId = str(payload.sid);
      if (!childId || !sessionId) return { ok: false, reason: "invalid" };
      return { ok: true, userId, role, childId, sessionId };
    }
    return { ok: true, userId, role };
  } catch (err) {
    // "expired" is worth telling apart: the frontend then quietly refreshes.
    if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
