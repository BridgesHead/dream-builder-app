import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblems, verifyPassword } from "../../src/lib/password.js";
import { createRandomToken, hashToken } from "../../src/lib/randomToken.js";

describe("password hashing (argon2)", () => {
  it("never stores the password itself, and checks it correctly", async () => {
    const hash = await hashPassword("Rocket123");
    expect(hash).not.toContain("Rocket123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Rocket123")).toBe(true);
    expect(await verifyPassword(hash, "rocket123")).toBe(false);
  });

  it("gives the same password a different hash each time (random salt)", async () => {
    expect(await hashPassword("Rocket123")).not.toBe(await hashPassword("Rocket123"));
  });

  it("treats a broken hash as 'no match' instead of crashing", async () => {
    expect(await verifyPassword("not-a-hash", "Rocket123")).toBe(false);
  });
});

describe("password rule", () => {
  it("accepts 8+ characters with a letter and a number", () => {
    expect(passwordProblems("Rocket123")).toEqual([]);
  });

  it.each([
    ["short1", "too short"],
    ["onlyletters", "no number"],
    ["12345678", "no letter"],
    ["a1".repeat(65), "longer than 128"],
  ])("refuses %s (%s)", (password) => {
    expect(passwordProblems(password).length).toBeGreaterThan(0);
  });
});

describe("random tokens", () => {
  it("are long, link-safe and never repeat", () => {
    const a = createRandomToken();
    const b = createRandomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hash to the same fingerprint every time, which isn't the token", () => {
    const t = createRandomToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
  });
});
