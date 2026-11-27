import type { PanelPicture } from "../jobs/providers.js";
import { IMAGE_TYPES } from "../lib/storage.js";
import { anonymise, findLeaks, NO_FAMILY, type FamilyDetails } from "./anonymise.js";

// THE one door out to any AI service (guide BE-10, BE-14): fal.ai, Gemini and Cloudflare.
// Every request to an AI goes through gatedPost, so for every service:
//   - the text is cleaned by the anonymising GATE first, and nothing is sent if anything
//     identifying is left; the cleaned text is kept for the job record
//   - every call has a time limit (a stuck call can't hold a worker)
//   - errors are short and cleaned (an AI's error reply could repeat our request)
// The client files (falClient.ts, geminiClient.ts, cloudflareClient.ts) only build the request
// body from the CLEANED text and read the reply. A test (tests/unit/falGate.test.ts) fails if
// any other file makes a network call.
//
// Rate limit: the queue already starts at most AI_CALLS_PER_SECOND jobs per second, shared by
// all workers (BE-07).

/** An AI call that failed. `service` is "fal.ai", "Gemini" or "Cloudflare". */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly service: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** One cleaned request, as it was sent (saved on the job: the anonymised prompt only). */
export interface SentRequest {
  endpoint: string;
  text: string;
}

/** The gate for one job's AI calls: who to protect, and what was sent. */
export interface AiGate {
  family: FamilyDetails;
  /** The name the AI knows the hero by (the real hero name, or the stand-in). */
  heroAlias: string;
  sent: SentRequest[];
}

export function createGate(family: FamilyDetails = NO_FAMILY, heroAlias: string): AiGate {
  return { family, heroAlias, sent: [] };
}

/** Something that writes text (the story, titles, scenes, rewrites). */
export interface TextClient {
  /** Saved on the job as `provider`. */
  readonly name: string;
  /** Saved on the job as `aiModel`. */
  readonly model: string;
  askText(gate: AiGate, input: { system: string; prompt: string }): Promise<string>;
}

/** Something that draws one panel picture. */
export interface ImageClient {
  readonly name: string;
  readonly model: string;
  drawImage(gate: AiGate, input: { prompt: string; seed: number }): Promise<PanelPicture>;
}

/** A short, cleaned piece of an AI's reply, for an error message. */
export function cleanDetail(gate: AiGate, text: unknown): string {
  return anonymise(String(text ?? "").replace(/\s+/g, " ").slice(0, 200), gate.family, gate.heroAlias);
}

export interface GatedRequest {
  service: string;
  /** A short name for the call (the model or endpoint), for the job record and errors. */
  endpoint: string;
  url: string;
  headers: Record<string, string>;
  /** Every piece of text the request carries. Only these are sent, and only after cleaning. */
  texts: Record<string, string>;
  /** Builds the body from the CLEANED texts (same keys). */
  body: (clean: Record<string, string>) => Record<string, unknown>;
  timeoutMs: number;
}

/** Cleans the texts, refuses to send a leak, then POSTs the JSON body with a time limit. */
export async function gatedPost<T>(gate: AiGate, req: GatedRequest): Promise<T> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.texts)) clean[key] = anonymise(value, gate.family, gate.heroAlias);
  const all = Object.values(clean).join("\n");
  const leaks = findLeaks(all, gate.family, gate.heroAlias);
  // The kinds only: the error (and so the job record and the logs) never holds the detail itself.
  if (leaks.length > 0) throw new AiError(`Not sent to ${req.service}: the request still had ${leaks.join(", ")}`, null, req.service);
  gate.sent.push({ endpoint: req.endpoint, text: Object.values(clean).join("\n\n") });

  let res: Response;
  try {
    res = await fetch(req.url, {
      method: "POST",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: JSON.stringify(req.body(clean)),
      signal: AbortSignal.timeout(req.timeoutMs),
    });
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? "took too long" : "could not be reached";
    throw new AiError(`${req.service} ${req.endpoint} ${why}`, null, req.service);
  }
  if (!res.ok) {
    const detail = cleanDetail(gate, await res.text().catch(() => ""));
    // 429 = too many calls, or (on a free plan) today's free allowance is used up.
    const hint = res.status === 429 ? " (rate limit or free allowance used up: try again later)" : "";
    throw new AiError(`${req.service} ${req.endpoint} answered ${res.status}${hint}${detail ? `: ${detail}` : ""}`, res.status, req.service);
  }
  return (await res.json()) as T;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** What kind of picture these bytes are, from their first bytes (never trust a label). */
function sniffType(body: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => body[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) return "image/webp";
  return null;
}

/** Checks picture bytes: a real PNG, JPEG or WebP of a sane size. */
export function checkPicture(service: string, body: Uint8Array): PanelPicture {
  if (body.length === 0 || body.length > MAX_IMAGE_BYTES) throw new AiError("The picture is empty or too big", null, service);
  const contentType = sniffType(body);
  const ext = contentType ? IMAGE_TYPES[contentType] : undefined;
  if (!contentType || !ext) throw new AiError(`${service} sent a file that is not a picture`, null, service);
  return { body, contentType, ext };
}

/** A picture an AI sent back inside its reply, as Base64 text. */
export function pictureFromBase64(service: string, data: unknown): PanelPicture {
  if (typeof data !== "string" || data.length === 0) throw new AiError(`${service} gave no picture`, null, service);
  return checkPicture(service, new Uint8Array(Buffer.from(data, "base64")));
}
