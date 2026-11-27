import { config } from "../config.js";
import { scaleToFit, type PictureSize } from "../engine/visual.js";
import { AiError, cleanDetail, gatedPost, pictureFromBase64, type AiGate, type ImageClient, type TextClient } from "./gate.js";

// Cloudflare Workers AI (api.cloudflare.com, /ai/run/<model>).
//   text      CLOUDFLARE_TEXT_MODEL  (default @cf/meta/llama-3.3-70b-instruct-fp8-fast)
//   pictures  CLOUDFLARE_IMAGE_MODEL (default @cf/black-forest-labs/flux-1-schnell: 1024 square only;
//             a FLUX.2 model, e.g. …/flux-2-klein-4b, makes each picture in its panel's shape)
// Both fit in Cloudflare's FREE daily allowance (10,000 "neurons" a day). When it runs out,
// Cloudflare answers 429 until the next day (the job then fails and can be tried again).
// Every call goes through the anonymising gate (gate.ts, BE-14). This is the only file that
// knows Cloudflare's address and token.
//
// Free tiers are for made-up test children only; the live app uses a paid plan.

const SERVICE = "Cloudflare";
// flux-1-schnell refuses a prompt longer than this.
const MAX_IMAGE_PROMPT = 2048;
// FLUX.2 on Cloudflare: width and height 256–1920.
const FLUX2_MAX_SIDE = 1920;

interface CloudflareReply<T> {
  success?: boolean;
  result?: T;
  errors?: { message?: string }[];
}

async function cloudflareRun<T>(
  gate: AiGate,
  model: string,
  texts: Record<string, string>,
  body: (clean: Record<string, string>) => Record<string, unknown>,
  format: "json" | "form" = "json",
): Promise<T> {
  const { accountId, token } = config.cloudflare;
  if (!accountId || !token) throw new AiError("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set", null, SERVICE);
  const reply = await gatedPost<CloudflareReply<T>>(gate, {
    service: SERVICE,
    endpoint: model,
    // The model id keeps its slashes: …/ai/run/@cf/black-forest-labs/flux-1-schnell
    url: `${config.cloudflare.baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
    headers: { Authorization: `Bearer ${token}` },
    texts,
    body,
    timeoutMs: config.cloudflare.callTimeoutMs,
    format,
  });
  if (reply.success === false || reply.result === undefined) {
    const detail = reply.errors?.map((e) => e.message).filter(Boolean).join("; ");
    throw new AiError(`Cloudflare ${model} gave no result${detail ? `: ${cleanDetail(gate, detail)}` : ""}`, null, SERVICE);
  }
  return reply.result;
}

export async function askText(gate: AiGate, input: { system: string; prompt: string }): Promise<string> {
  const model = config.cloudflare.textModel;
  const result = await cloudflareRun<{ response?: unknown }>(gate, model, { system: input.system, prompt: input.prompt }, (c) => ({
    messages: [
      { role: "system", content: c.system },
      { role: "user", content: c.prompt },
    ],
    // The default (256) is far too short for a 15-panel story.
    max_tokens: config.cloudflare.maxTokens,
  }));
  // Some models hand back JSON already read into an object: turn it back into text.
  const response = result.response;
  const text = typeof response === "string" ? response : response && typeof response === "object" ? JSON.stringify(response) : "";
  if (text.trim() === "") throw new AiError(`Cloudflare ${model} gave no text`, null, SERVICE);
  return text;
}

/** The FLUX.2 models ("@cf/black-forest-labs/flux-2-dev", "…/flux-2-klein-4b", …) take a size and a seed. */
const takesSize = (model: string) => /\/flux-2/.test(model);

export async function drawImage(gate: AiGate, input: { prompt: string; seed: number; size: PictureSize }) {
  const model = config.cloudflare.imageModel;
  const prompt = { prompt: input.prompt.slice(0, MAX_IMAGE_PROMPT) };
  const result = takesSize(model)
    ? // FLUX.2: the picture in its panel's shape, up to 1920 px a side, with the story's seed.
      // These models take multipart form data, not JSON (Cloudflare's docs).
      await cloudflareRun<{ image?: unknown }>(
        gate,
        model,
        prompt,
        (c) => {
          const size = scaleToFit(input.size, FLUX2_MAX_SIDE);
          return { prompt: c.prompt.slice(0, MAX_IMAGE_PROMPT), width: size.width, height: size.height, seed: input.seed };
        },
        "form",
      )
    : // flux-1-schnell: always 1024 × 1024 and no seed, so the hero may look a little different
      // from panel to panel. The book crops the square to the panel's shape.
      await cloudflareRun<{ image?: unknown }>(gate, model, prompt, (c) => ({
        prompt: c.prompt.slice(0, MAX_IMAGE_PROMPT),
        steps: config.cloudflare.imageSteps,
      }));
  return pictureFromBase64(SERVICE, result.image);
}

export const cloudflareText: TextClient = {
  name: "cloudflare",
  get model() {
    return config.cloudflare.textModel;
  },
  askText,
};

export const cloudflareImage: ImageClient = {
  name: "cloudflare",
  get model() {
    return config.cloudflare.imageModel;
  },
  drawImage,
};
