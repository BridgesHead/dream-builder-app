// FAKE Gemini and Cloudflare Workers AI servers in one, for the free-mode tests. They answer like
// the real services, run on this PC, cost nothing, and record every request so tests can check
// what we sent. CI never calls the real Gemini or Cloudflare.
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { STAND_IN } from "../../src/ai/prompts.js";
import { FAKE_PNG } from "./fakeFal.js";

export const GEMINI_TEST_KEY = "test-gemini-key-123";
export const CLOUDFLARE_TEST_ACCOUNT = "acct-test-123456";
export const CLOUDFLARE_TEST_TOKEN = "test-cf-token-123";

// The first bytes of a JPEG: enough for our picture check, and it lets tests see ".jpg" keys.
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

export interface AiRequest {
  service: "gemini" | "cloudflare";
  path: string;
  body: Record<string, unknown>;
}

export interface FakeFreeAi {
  url: string;
  requests: AiRequest[];
  /** The normal story-text reply (a JSON string). */
  story: string;
  title: string;
  /** The next N picture calls (either service) answer 429, like a used-up free allowance. */
  pictureFailures: number;
  /** true: Gemini blocks every story-text call (no candidates, a blockReason). */
  geminiBlocks: boolean;
  /** Gemini models that answer 503 "high demand" to every call. */
  busyModels: Set<string>;
  reset(): void;
  close(): Promise<void>;
}

/** What the fake text AI says, from the same system prompts the real code sends. */
function textReply(fake: FakeFreeAi, system: string, prompt: string): string {
  if (system.startsWith("You are the Scene Director")) return "the hero kneels beside a sleepy puppy in the clinic, warm morning light";
  if (prompt.includes("Write the title")) return fake.title;
  // A comic page (BE-11): 4 cells, with the stand-in name (the only name the AI ever sees).
  if (system.startsWith("You are the writer of a premium comic picture book")) {
    const cells = [0, 1, 2, 3].map((i) => ({
      caption: `${STAND_IN} takes step ${i + 1}.`,
      dialogue: i === 3 ? null : i === 2 ? "Maybe I can…" : "I can do this.",
      bubble: i === 3 ? "none" : i === 2 ? "thought" : "speech",
      tempo: i === 3 ? "♪ la la ♫" : null,
      scene: `${STAND_IN} walks along a sunny path`,
    }));
    return JSON.stringify({ cells });
  }
  return fake.story;
}

export async function startFakeFreeAi(): Promise<FakeFreeAi> {
  const fake: FakeFreeAi = {
    url: "",
    requests: [],
    story: "{}",
    title: "Tibbo and the Whispering Clinic",
    pictureFailures: 0,
    geminiBlocks: false,
    busyModels: new Set(),
    reset() {
      this.requests = [];
      this.story = "{}";
      this.title = "Tibbo and the Whispering Clinic";
      this.pictureFailures = 0;
      this.geminiBlocks = false;
      this.busyModels.clear();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const pictureFails = () => {
    if (fake.pictureFailures <= 0) return false;
    fake.pictureFailures -= 1;
    return true;
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const path = decodeURIComponent(req.url ?? "");
      const raw = Buffer.concat(chunks);
      const type = String(req.headers["content-type"] ?? "");
      // Cloudflare's FLUX.2 models are sent multipart form data; everything else is JSON.
      const form = type.startsWith("multipart/form-data") ? Object.fromEntries(await new Response(raw, { headers: { "content-type": type } }).formData()) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a fake server reads any shape
      const body = (form ?? JSON.parse(raw.toString("utf8") || "{}")) as Record<string, any>;
      if (form) body.__format = "form";

      // ---- Gemini: POST /v1beta/models/<model>:generateContent ----
      if (path.startsWith("/v1beta/models/")) {
        if (req.headers["x-goog-api-key"] !== GEMINI_TEST_KEY) return send(res, 400, { error: { message: "API key not valid" } });
        fake.requests.push({ service: "gemini", path, body });
        const model = path.slice("/v1beta/models/".length).split(":")[0];
        if (fake.busyModels.has(model)) return send(res, 503, { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } });
        if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
          if (pictureFails()) return send(res, 429, { error: { message: "Resource has been exhausted" } });
          return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: FAKE_PNG.toString("base64") } }] } }] });
        }
        const system = String(body.systemInstruction?.parts?.[0]?.text ?? "");
        const prompt = String(body.contents?.[0]?.parts?.[0]?.text ?? "");
        if (fake.geminiBlocks && !system.startsWith("You are the Scene Director") && !prompt.includes("Write the title")) {
          return send(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
        }
        // A "thought" part first, like a thinking model: it must be ignored.
        return send(res, 200, { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: textReply(fake, system, prompt) }] } }] });
      }

      // ---- Cloudflare: POST /accounts/<id>/ai/run/<model> ----
      const cf = path.match(/^\/accounts\/([^/]+)\/ai\/run\/(.+)$/);
      if (cf) {
        if (req.headers.authorization !== `Bearer ${CLOUDFLARE_TEST_TOKEN}` || cf[1] !== CLOUDFLARE_TEST_ACCOUNT) {
          return send(res, 401, { success: false, errors: [{ message: "Authentication error" }] });
        }
        fake.requests.push({ service: "cloudflare", path, body });
        if (cf[2].includes("flux")) {
          if (pictureFails()) return send(res, 429, { success: false, errors: [{ message: "daily free allocation used" }] });
          if (String(body.prompt ?? "").length > 2048) return send(res, 400, { success: false, errors: [{ message: "prompt too long" }] });
          return send(res, 200, { success: true, result: { image: FAKE_JPEG.toString("base64") } });
        }
        const messages = (body.messages ?? []) as { role: string; content: string }[];
        const system = messages.find((m) => m.role === "system")?.content ?? "";
        const prompt = messages.find((m) => m.role === "user")?.content ?? "";
        return send(res, 200, { success: true, result: { response: textReply(fake, system, prompt) } });
      }

      send(res, 404, { error: "no such endpoint" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
