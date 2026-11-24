import { config } from "../config.js";
import { IMAGE_TYPES } from "../lib/storage.js";
import { anonymise, findLeaks, NO_FAMILY, type FamilyDetails } from "./anonymise.js";

// THE one door to fal.ai (guide BE-10). Every fal.ai call goes through here, so:
//   - the secret key is added in one place and never logged
//   - every call has a time limit (a stuck call can't hold a worker)
//   - every call passes the anonymising GATE (guide BE-14): askText and drawImage can only be
//     called with a gate, which cleans the text, refuses to send if anything identifying is
//     left, and keeps the cleaned text for the job record. The raw falPost is NOT exported,
//     and a test (tests/unit/falGate.test.ts) fails if any other file talks to fal.ai.
//
// Rate limit: the queue already starts at most AI_CALLS_PER_SECOND jobs per second, shared by
// all workers (BE-07).

export class FalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "FalError";
  }
}

/** One cleaned request, as it was sent (saved on the job: the anonymised prompt only). */
export interface SentRequest {
  endpoint: string;
  text: string;
}

/** The gate for one job's AI calls: who to protect, and what was sent. */
export interface FalGate {
  family: FamilyDetails;
  /** The name the AI knows the hero by (the real hero name, or the stand-in). */
  heroAlias: string;
  sent: SentRequest[];
}

export function createGate(family: FamilyDetails = NO_FAMILY, heroAlias: string): FalGate {
  return { family, heroAlias, sent: [] };
}

/** Cleans every text field of a request body, then checks nothing identifying is left. */
function pass(gate: FalGate, endpoint: string, body: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...body };
  const texts: string[] = [];
  for (const [key, value] of Object.entries(clean)) {
    if (typeof value !== "string") continue;
    const cleaned = anonymise(value, gate.family, gate.heroAlias);
    clean[key] = cleaned;
    texts.push(cleaned);
  }
  const leaks = findLeaks(texts.join("\n"), gate.family, gate.heroAlias);
  // The kinds only: the error (and so the job record and the logs) never holds the detail itself.
  if (leaks.length > 0) throw new FalError(`Not sent to fal.ai: the request still had ${leaks.join(", ")}`, null);
  gate.sent.push({ endpoint, text: texts.join("\n\n") });
  return clean;
}

async function falPost<T>(gate: FalGate, endpoint: string, rawBody: Record<string, unknown>): Promise<T> {
  if (!config.fal.key) throw new FalError("FAL_KEY is not set", null);
  const body = pass(gate, endpoint, rawBody);
  let res: Response;
  try {
    res = await fetch(`${config.fal.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${config.fal.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.fal.callTimeoutMs),
    });
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? "took too long" : "could not be reached";
    throw new FalError(`fal.ai ${endpoint} ${why}`, null);
  }
  if (!res.ok) {
    // A short reason only: fal.ai's reply, cut down and cleaned (it could repeat our request).
    const detail = anonymise((await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200), gate.family, gate.heroAlias);
    throw new FalError(`fal.ai ${endpoint} answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

/** Text from the LLM (fal-ai/any-llm). */
export async function askText(gate: FalGate, input: { system: string; prompt: string }): Promise<string> {
  const reply = await falPost<{ output?: unknown; error?: unknown }>(gate, config.fal.textEndpoint, {
    model: config.fal.textModel,
    system_prompt: input.system,
    prompt: input.prompt,
  });
  if (typeof reply.output !== "string" || reply.output.trim() === "") {
    const why = reply.error ? `: ${anonymise(String(reply.error).slice(0, 200), gate.family, gate.heroAlias)}` : "";
    throw new FalError(`fal.ai ${config.fal.textEndpoint} gave no text${why}`, null);
  }
  return reply.output;
}

/** One FLUX picture. Returns fal.ai's TEMPORARY link: download it, never store it. */
export async function drawImage(gate: FalGate, input: { prompt: string; seed: number }): Promise<string> {
  const reply = await falPost<{ images?: { url?: unknown }[] }>(gate, config.fal.imageModel, {
    prompt: input.prompt,
    seed: input.seed,
    image_size: "landscape_4_3",
    num_images: 1,
    enable_safety_checker: true,
  });
  const url = reply.images?.[0]?.url;
  if (typeof url !== "string") throw new FalError(`fal.ai ${config.fal.imageModel} gave no picture`, null);
  return url;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// Only https links (fal.ai's are). Plain http is allowed for a local fake fal.ai in tests.
function downloadable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return !config.isProduction && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Downloads fal.ai's picture so we can keep our own copy. Sends nothing about the child. */
export async function downloadImage(url: string): Promise<{ body: Uint8Array; contentType: string; ext: string }> {
  if (!downloadable(url)) throw new FalError("fal.ai gave a picture link we won't download", null);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.fal.callTimeoutMs) });
  } catch {
    throw new FalError("The picture could not be downloaded from fal.ai", null);
  }
  if (!res.ok) throw new FalError(`The picture download answered ${res.status}`, res.status);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new FalError(`fal.ai sent a "${contentType || "unknown"}" file, not a picture`, null);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length === 0 || body.length > MAX_IMAGE_BYTES) throw new FalError("The picture is empty or too big", null);
  return { body, contentType, ext };
}
