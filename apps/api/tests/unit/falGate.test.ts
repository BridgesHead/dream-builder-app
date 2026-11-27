// BE-14: no code talks to an AI service (fal.ai, Gemini, Cloudflare) without the anonymising gate.
// This test reads every source file, so a new file that calls an AI some other way fails CI.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cloudflareClient from "../../src/ai/cloudflareClient.js";
import * as falClient from "../../src/ai/falClient.js";
import * as gate from "../../src/ai/gate.js";
import * as geminiClient from "../../src/ai/geminiClient.js";

const SRC = path.resolve(import.meta.dirname, "../../src");
const GATE = path.join("ai", "gate.ts");
const FAL = path.join("ai", "falClient.ts");
const GEMINI = path.join("ai", "geminiClient.ts");
const CLOUDFLARE = path.join("ai", "cloudflareClient.ts");
const CLIENTS = [FAL, GEMINI, CLOUDFLARE];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({ rel: path.relative(SRC, full), text: readFileSync(full, "utf8") }));
const NO_FAMILY = { childNames: [], grownUpNames: [], authorNames: [], emails: [], phones: [], addressLines: [] };

/** Files (other than `owner` and config.ts) that mention a service's address or key. */
const othersMentioning = (owner: string, pattern: RegExp) =>
  files.filter((f) => f.rel !== owner && f.rel !== "config.ts" && pattern.test(f.text)).map((f) => f.rel);

describe("the one door to the AI services", () => {
  it("only gate.ts sends (fetch); falClient.ts may only DOWNLOAD fal.ai's picture", () => {
    const offenders = files.filter((f) => f.rel !== GATE && f.rel !== FAL && /\bfetch\s*\(/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
    // falClient's one fetch is the GET download (no body, nothing about the child).
    const falFetches = files.find((f) => f.rel === FAL)!.text.match(/\bfetch\s*\(/g) ?? [];
    expect(falFetches).toHaveLength(1);
    expect(files.find((f) => f.rel === FAL)!.text).toMatch(/fetch\(url, \{ signal:/);
  });

  it("only each client knows its service's address and key", () => {
    expect(othersMentioning(FAL, /fal\.run|fal\.baseUrl|fal\.key\b|FAL_KEY/)).toEqual([]);
    expect(othersMentioning(GEMINI, /generativelanguage|gemini\.baseUrl|gemini\.key\b|GEMINI_API_KEY/)).toEqual([]);
    expect(othersMentioning(CLOUDFLARE, /api\.cloudflare\.com|cloudflare\.baseUrl|cloudflare\.token\b|CLOUDFLARE_API_TOKEN/)).toEqual([]);
  });

  it("only the real provider imports the clients", () => {
    for (const client of CLIENTS) {
      const name = path.basename(client, ".ts");
      const importers = files
        .filter((f) => f.rel !== client)
        .filter((f) => new RegExp(`^import (?!type).*from\\s+["'][./]*.*${name}(\\.js)?["']`, "m").test(f.text))
        .map((f) => f.rel);
      expect(importers, name).toEqual([path.join("ai", "realProvider.ts")]);
    }
  });

  it("every function that sends takes the gate first; the raw sender is not exported", () => {
    expect(gate.gatedPost.length).toBe(2); // (gate, request)
    for (const client of [falClient, geminiClient, cloudflareClient]) {
      expect(client.askText.length).toBe(2); // (gate, input)
      expect(client.drawImage.length).toBe(2);
    }
    expect(Object.keys(falClient).sort()).toEqual(["askText", "downloadImage", "drawImage", "falImage", "falText"]);
    expect(Object.keys(geminiClient).sort()).toEqual(["askText", "drawImage", "geminiImage", "geminiText"]);
    expect(Object.keys(cloudflareClient).sort()).toEqual(["askText", "cloudflareImage", "cloudflareText", "drawImage"]);
  });

  it("cleans before the key check, and refuses a missing key without sending", async () => {
    // A family whose child's name is also inside an email the patterns can't see as one.
    const g = gate.createGate({ ...NO_FAMILY, childNames: ["Zed"] }, "Tibbo");
    // No keys are set in tests: the errors must be about the key, not a leak.
    await expect(falClient.askText(g, { system: "s", prompt: "Zed smiled." })).rejects.toThrow(/FAL_KEY/);
    await expect(geminiClient.askText(g, { system: "s", prompt: "Zed smiled." })).rejects.toThrow(/GEMINI_API_KEY/);
    await expect(cloudflareClient.drawImage(g, { prompt: "Zed smiled.", seed: 1, size: { width: 1024, height: 1024 } })).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
  });

  it("cleans every text before it is sent, and keeps only the cleaned text for the job record", async () => {
    const g = gate.createGate({ ...NO_FAMILY, childNames: ["Zed"], emails: ["zed@example.com"] }, "Tibbo");
    let sentBody: Record<string, unknown> = {};
    // Nothing listens on port 9, so the call fails AFTER the body is built.
    const send = gate.gatedPost(g, {
      service: "Test",
      endpoint: "x",
      url: "http://127.0.0.1:9/never",
      headers: {},
      texts: { system: "Write for Zed.", prompt: "Zed smiled. Mail zed@example.com" },
      body: (c) => (sentBody = { ...c }),
      timeoutMs: 500,
    });
    await expect(send).rejects.toThrow(/Test x (could not be reached|took too long)/);
    const everything = JSON.stringify(sentBody) + g.sent[0].text;
    expect(everything).not.toMatch(/Zed|zed@example\.com/);
    expect(everything).toContain("Tibbo");
  });

  it("only real pictures are kept, whatever the label says", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    expect(gate.pictureFromBase64("T", png.toString("base64"))).toMatchObject({ contentType: "image/png", ext: "png" });
    expect(gate.pictureFromBase64("T", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64"))).toMatchObject({ ext: "jpg" });
    expect(() => gate.pictureFromBase64("T", Buffer.from("<html>").toString("base64"))).toThrow(/not a picture/);
    expect(() => gate.pictureFromBase64("T", "")).toThrow(/no picture/);
  });
});
