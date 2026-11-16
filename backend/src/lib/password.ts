import { randomBytes } from "node:crypto";
import argon2 from "argon2";

// argon2id: the recommended way to store passwords. It is deliberately SLOW and uses a lot
// of memory, so someone who steals the database can only try a few guesses per second.
// The hash includes a random "salt", so two parents with the same password get different hashes.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// true if the password matches the hash. A broken or empty hash just means "no match".
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real hash that no password matches. Login checks against it when the email is unknown,
// so "unknown email" takes as long as "wrong password" and timing reveals nothing.
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString("hex"));

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// The password rule. Returns what's wrong, or [] if the password is fine.
// 8 characters matches the sign-up screen. The upper limit stops someone sending a
// giant "password" to keep the server busy hashing it.
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters`);
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters`);
  if (!/[A-Za-z]/.test(password)) problems.push("Include at least one letter");
  if (!/[0-9]/.test(password)) problems.push("Include at least one number");
  return problems;
}
