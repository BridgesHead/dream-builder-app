import { config } from "../config.js";
import { AiError, cleanDetail, gatedPost, pictureFromBase64, type AiGate, type ImageClient, type TextClient } from "./gate.js";

// Google Gemini (generativelanguage.googleapis.com), the generateContent API.
//   text      GEMINI_TEXT_MODEL  (default gemini-3.5-flash-lite; Google's free tier covers it),
//             then GEMINI_TEXT_BACKUP_MODELS, straight away, when it says it's busy
//   pictures  GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image; PAID, no free tier)
// Every call goes through the anonymising gate (gate.ts, BE-14). This is the only file that
// knows Gemini's address and key.
//
// On Google's FREE tier, Google may use what we send to improve its products. So the free tier
// is for made-up test children only; the live app uses a paid plan (Sami Bhai decides).

const SERVICE = "Gemini";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiReply {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function geminiPost(gate: AiGate, model: string, texts: Record<string, string>, body: (clean: Record<string, string>) => Record<string, unknown>) {
  if (!config.gemini.key) throw new AiError("GEMINI_API_KEY is not set", null, SERVICE);
  return gatedPost<GeminiReply>(gate, {
    service: SERVICE,
    endpoint: model,
    url: `${config.gemini.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { "x-goog-api-key": config.gemini.key },
    texts,
    body,
    timeoutMs: config.gemini.callTimeoutMs,
  });
}

const partsOf = (reply: GeminiReply): GeminiPart[] => reply.candidates?.[0]?.content?.parts ?? [];

/** Why Gemini gave nothing useful: a safety block or an odd finish, cleaned. */
function why(gate: AiGate, reply: GeminiReply): string {
  const reason = reply.promptFeedback?.blockReason ?? reply.candidates?.[0]?.finishReason;
  return reason ? ` (${cleanDetail(gate, reason)})` : "";
}

// "Busy" answers: too many requests, or Google's servers overloaded. Worth another model now.
const BUSY = new Set([429, 500, 502, 503, 504]);

/**
 * The text from the main model, or (when it's busy) from the next backup model. Any other
 * problem (a bad key, a blocked story, no text) fails straight away, as before.
 */
export async function askText(gate: AiGate, input: { system: string; prompt: string }): Promise<string> {
  const models = [config.gemini.textModel, ...config.gemini.textBackupModels.filter((m) => m !== config.gemini.textModel)];
  for (let i = 0; ; i += 1) {
    try {
      return await askModel(gate, models[i], input);
    } catch (err) {
      const busy = err instanceof AiError && err.status !== null && BUSY.has(err.status);
      if (!busy || i === models.length - 1) throw err;
    }
  }
}

async function askModel(gate: AiGate, model: string, input: { system: string; prompt: string }): Promise<string> {
  const reply = await geminiPost(gate, model, { system: input.system, prompt: input.prompt }, (c) => ({
    systemInstruction: { parts: [{ text: c.system }] },
    contents: [{ role: "user", parts: [{ text: c.prompt }] }],
  }));
  // Thinking models may send their "thoughts" as extra parts: only the answer counts.
  const text = partsOf(reply)
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (text.trim() === "") throw new AiError(`Gemini ${model} gave no text${why(gate, reply)}`, null, SERVICE);
  return text;
}

export async function drawImage(gate: AiGate, input: { prompt: string; seed: number }) {
  const model = config.gemini.imageModel;
  const reply = await geminiPost(gate, model, { prompt: input.prompt }, (c) => ({
    contents: [{ role: "user", parts: [{ text: c.prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      // The story's seed: helps the hero look the same from panel to panel.
      seed: input.seed,
      imageConfig: { aspectRatio: "4:3" },
    },
  }));
  const part = partsOf(reply).find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!part) throw new AiError(`Gemini ${model} gave no picture${why(gate, reply)}`, null, SERVICE);
  return pictureFromBase64(SERVICE, part.inlineData?.data ?? part.inline_data?.data);
}

export const geminiText: TextClient = {
  name: "gemini",
  get model() {
    return config.gemini.textModel;
  },
  askText,
};

export const geminiImage: ImageClient = {
  name: "gemini",
  get model() {
    return config.gemini.imageModel;
  },
  drawImage,
};
