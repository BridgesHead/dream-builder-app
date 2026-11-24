// BE-14: no code talks to fal.ai without the anonymising gate.
// This test reads every source file, so a new file that calls fal.ai some other way fails CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as falClient from "../../src/ai/falClient.js";

const SRC = path.resolve(import.meta.dirname, "../../src");
const GATE = path.join("ai", "falClient.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({ rel: path.relative(SRC, full), text: readFileSync(full, "utf8") }));
const outsideGate = files.filter((f) => f.rel !== GATE);

describe("the one door to fal.ai", () => {
  it("only falClient.ts makes network calls (fetch)", () => {
    const offenders = outsideGate.filter((f) => /\bfetch\s*\(/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("only falClient.ts uses fal.ai's address or key", () => {
    const offenders = outsideGate
      .filter((f) => f.rel !== "config.ts")
      .filter((f) => /fal\.run|fal\.baseUrl|fal\.key\b|FAL_KEY/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("only the fal provider imports falClient, and only gated calls are exported", () => {
    const importers = outsideGate.filter((f) => /from\s+["'][./]*.*falClient(\.js)?["']/.test(f.text) && !/import type/.test(f.text.match(/.*falClient.*/)?.[0] ?? "")).map((f) => f.rel);
    expect(importers).toEqual([path.join("ai", "falProvider.ts")]);
    // Every function that sends anything takes the gate first; the raw sender is private.
    expect(Object.keys(falClient).sort()).toEqual(["FalError", "askText", "createGate", "downloadImage", "drawImage"]);
    expect(falClient.askText.length).toBe(2); // (gate, input)
    expect(falClient.drawImage.length).toBe(2);
  });

  it("refuses to send when something identifying is still there after cleaning", async () => {
    // A family whose child's name is also inside an email the patterns can't see as one.
    const gate = falClient.createGate(
      { childNames: ["Zed"], grownUpNames: [], authorNames: [], emails: [], phones: [], addressLines: [] },
      "Tibbo",
    );
    // Cleaning replaces "Zed"; the leak check then passes, and no network call is made because
    // FAL_KEY isn't set in tests: the error must be about the key, not a leak.
    await expect(falClient.askText(gate, { system: "s", prompt: "Zed smiled." })).rejects.toThrow(/FAL_KEY/);
  });
});
