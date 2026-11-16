import { errors, jwtVerify, SignJWT } from "jose";
import { config } from "../config.js";
import type { UserRole } from "../db/models/index.js";

// The access token (the 15-minute "wristband") is a JWT: a small piece of signed JSON,
//   { sub: "<user id>", role: "parent", exp: <when it expires>, ... }
// signed with JWT_ACCESS_SECRET. Anyone can READ a JWT, but nobody can CHANGE one or make
// a new one without the secret, because the signature would no longer match.
// So: never put anything private inside it. We only put the user id and role.

export const ACCESS_TOKEN_SECONDS = 15 * 60;

const ISSUER = "dream-builder-api";
const AUDIENCE = "dream-builder";
const key = new TextEncoder().encode(config.jwtAccessSecret);

export function createAccessToken(userId: string, role: UserRole): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
    .sign(key);
}

export type AccessTokenCheck = { ok: true; userId: string } | { ok: false; reason: "expired" | "invalid" };

// Checks the signature, who made it, who it's for, and that it hasn't expired.
export async function checkAccessToken(token: string): Promise<AccessTokenCheck> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== "string") return { ok: false, reason: "invalid" };
    return { ok: true, userId: payload.sub };
  } catch (err) {
    // "expired" is worth telling apart: the frontend then quietly refreshes.
    if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
