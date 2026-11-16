import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { checkAccessToken, createAccessToken } from "../../src/services/accessTokens.js";

const userId = "665f1c2ab0d4e1a2b3c4d5e6";
const realKey = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

// Makes a token by hand, to test tokens our server would never make.
function handMade(key: Uint8Array, expiresAt: number) {
  return new SignJWT({ role: "parent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("dream-builder-api")
    .setAudience("dream-builder")
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

describe("access tokens", () => {
  it("a fresh token checks out and carries the user id", async () => {
    const token = await createAccessToken(userId, "parent");
    expect(await checkAccessToken(token)).toEqual({ ok: true, userId });
  });

  it("an expired token is 'expired'", async () => {
    const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;
    expect(await checkAccessToken(await handMade(realKey, oneMinuteAgo))).toEqual({ ok: false, reason: "expired" });
  });

  it("a token signed with a different secret is 'invalid'", async () => {
    const fake = await handMade(new TextEncoder().encode("a-hackers-guess-at-our-secret-key-00000"), Math.floor(Date.now() / 1000) + 600);
    expect(await checkAccessToken(fake)).toEqual({ ok: false, reason: "invalid" });
  });

  it("a token someone edited is 'invalid'", async () => {
    const token = await createAccessToken(userId, "parent");
    const [header, , signature] = token.split(".");
    const editedBody = Buffer.from(JSON.stringify({ sub: userId, role: "admin" })).toString("base64url");
    expect(await checkAccessToken(`${header}.${editedBody}.${signature}`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rubbish is 'invalid'", async () => {
    expect(await checkAccessToken("not.a.token")).toEqual({ ok: false, reason: "invalid" });
  });
});
