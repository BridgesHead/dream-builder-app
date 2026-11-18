import { config } from "../config.js";
import { IMAGE_TYPES } from "../lib/storage.js";

// THE one door to fal.ai (guide BE-10). Every fal.ai call goes through here, so:
//   - the secret key is added in one place and never logged
//   - every call has a time limit (a stuck call can't hold a worker)
//   - BE-14 adds the anonymising gate in this same place
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

async function falPost<T>(endpoint: string, body: unknown): Promise<T> {
  if (!config.fal.key) throw new FalError("FAL_KEY is not set", null);
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
    // A short reason only: fal.ai's reply, cut down. Never the request (it holds the prompt).
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new FalError(`fal.ai ${endpoint} answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

/** Text from the LLM (fal-ai/any-llm). */
export async function askText(input: { system: string; prompt: string }): Promise<string> {
  const reply = await falPost<{ output?: unknown; error?: unknown }>(config.fal.textEndpoint, {
    model: config.fal.textModel,
    system_prompt: input.system,
    prompt: input.prompt,
  });
  if (typeof reply.output !== "string" || reply.output.trim() === "") {
    throw new FalError(`fal.ai ${config.fal.textEndpoint} gave no text${reply.error ? `: ${String(reply.error).slice(0, 200)}` : ""}`, null);
  }
  return reply.output;
}

/** One FLUX picture. Returns fal.ai's TEMPORARY link: download it, never store it. */
export async function drawImage(input: { prompt: string; seed: number }): Promise<string> {
  const reply = await falPost<{ images?: { url?: unknown }[] }>(config.fal.imageModel, {
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

/** Downloads fal.ai's picture so we can keep our own copy. */
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
