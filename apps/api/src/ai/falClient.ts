import { config } from "../config.js";
import { scaleToFit, type PictureSize } from "../engine/visual.js";
import type { PanelPicture } from "../jobs/providers.js";
import { AiError, checkPicture, cleanDetail, gatedPost, type AiGate, type ImageClient, type TextClient } from "./gate.js";

// fal.ai (guide BE-10): text from fal-ai/any-llm, pictures from FLUX.
// Every call goes through the anonymising gate (gate.ts, BE-14). This is the only file that
// knows fal.ai's address and key.

const SERVICE = "fal.ai";

function falKey(): string {
  if (!config.fal.key) throw new AiError("FAL_KEY is not set", null, SERVICE);
  return config.fal.key;
}

function falPost<T>(gate: AiGate, endpoint: string, texts: Record<string, string>, body: (clean: Record<string, string>) => Record<string, unknown>): Promise<T> {
  return gatedPost<T>(gate, {
    service: SERVICE,
    endpoint,
    url: `${config.fal.baseUrl}/${endpoint}`,
    headers: { Authorization: `Key ${falKey()}` },
    texts,
    body,
    timeoutMs: config.fal.callTimeoutMs,
  });
}

/** Text from the LLM (fal-ai/any-llm). */
export async function askText(gate: AiGate, input: { system: string; prompt: string }): Promise<string> {
  const reply = await falPost<{ output?: unknown; error?: unknown }>(gate, config.fal.textEndpoint, { system: input.system, prompt: input.prompt }, (c) => ({
    model: config.fal.textModel,
    system_prompt: c.system,
    prompt: c.prompt,
  }));
  if (typeof reply.output !== "string" || reply.output.trim() === "") {
    const why = reply.error ? `: ${cleanDetail(gate, reply.error)}` : "";
    throw new AiError(`fal.ai ${config.fal.textEndpoint} gave no text${why}`, null, SERVICE);
  }
  return reply.output;
}

// FLUX.2 on fal.ai takes 512–2048 px a side; FLUX.1 more, but it is best at this size too.
const FAL_MAX_SIDE = 2048;

/**
 * One FLUX picture, in the shape and size asked for (fal.ai takes an exact width and height).
 * Returns fal.ai's TEMPORARY link: download it, never store it.
 */
export async function drawImage(gate: AiGate, input: { prompt: string; seed: number; size: PictureSize }): Promise<string> {
  const reply = await falPost<{ images?: { url?: unknown }[] }>(gate, config.fal.imageModel, { prompt: input.prompt }, (c) => ({
    prompt: c.prompt,
    seed: input.seed,
    image_size: scaleToFit(input.size, FAL_MAX_SIDE),
    num_images: 1,
    enable_safety_checker: true,
  }));
  const url = reply.images?.[0]?.url;
  if (typeof url !== "string") throw new AiError(`fal.ai ${config.fal.imageModel} gave no picture`, null, SERVICE);
  return url;
}

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
export async function downloadImage(url: string): Promise<PanelPicture> {
  if (!downloadable(url)) throw new AiError("fal.ai gave a picture link we won't download", null, SERVICE);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.fal.callTimeoutMs) });
  } catch {
    throw new AiError("The picture could not be downloaded from fal.ai", null, SERVICE);
  }
  if (!res.ok) throw new AiError(`The picture download answered ${res.status}`, res.status, SERVICE);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new AiError(`fal.ai sent a "${contentType || "unknown"}" file, not a picture`, null, SERVICE);
  return checkPicture(SERVICE, new Uint8Array(await res.arrayBuffer()));
}

export const falText: TextClient = {
  name: "fal",
  get model() {
    return config.fal.textModel;
  },
  askText,
};

export const falImage: ImageClient = {
  name: "fal",
  get model() {
    return config.fal.imageModel;
  },
  async drawImage(gate, input) {
    return downloadImage(await drawImage(gate, input));
  },
};
