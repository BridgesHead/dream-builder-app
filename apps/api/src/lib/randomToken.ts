import { createHash, randomBytes } from "node:crypto";

// A random, unguessable token, e.g. "q3J9x...". 32 random bytes = 256 bits: guessing one is
// practically impossible. base64url uses only characters that are safe inside a link.
// Used for refresh tokens and for the tokens in verify / reset email links.
export function createRandomToken(): string {
  return randomBytes(32).toString("base64url");
}

// We store only this SHA-256 fingerprint of a token, never the token itself.
// If the database ever leaks, the fingerprints can't be turned back into working tokens.
// (A fast hash is fine here, unlike passwords: the token is already long and random.)
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
