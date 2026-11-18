import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";

// The "version" field from package.json, e.g. "1.0.0".
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Describe the environment variables we expect, with defaults for local dev.
// z.coerce turns the string "3000" from .env into the number 3000.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Where MongoDB lives. Must start with mongodb:// (local) or mongodb+srv:// (Atlas).
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
  // Set by the deploy step (AWS-01), e.g. the git commit "5081b44". Empty on your PC.
  BUILD_VERSION: z.string().min(1).optional(),
  // How chatty the logs are. "debug" shows more, "warn" shows only problems.
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // The secret that signs access tokens. Anyone who knows it can make tokens, so it lives
  // only in .env (your PC) or the AWS secret store, never in the repo. At least 32 characters.
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "must be at least 32 characters")
    .refine((v) => !v.startsWith("replace-me"), "still the placeholder from .env.example: make your own secret"),
  // The frontend's address. Links in emails point here, e.g. <APP_URL>/verify-email?token=...
  APP_URL: z.url().default("http://localhost:5173"),
  // Which version of the consent text parents agree to. Change it when the text changes;
  // every new consent then records the new version (old records stay as they were).
  CONSENT_TEXT_VERSION: z.string().min(1).max(50).default("2026-11-v1"),
  // How many proxies sit in front of the API (AWS load balancer = 1). Needed so req.ip is the
  // parent's real IP address (for consent records and rate limits), not the proxy's. 0 on your PC.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  // ---- Background jobs (BE-07) ----
  // Where Redis lives, e.g. redis://127.0.0.1:6379. Set: BullMQ queue + separate workers
  // (pnpm worker). Not set: an in-memory queue inside the API, for your PC only.
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "must start with redis:// or rediss://").optional(),
  // Who makes the text and pictures. "stub" = fake placeholders until BE-10 adds fal.ai.
  AI_PROVIDER: z.enum(["stub"]).default("stub"),
  // How long the fake AI takes per job, so progress is visible on Final Climb.
  STUB_DELAY_MS: z.coerce.number().int().min(0).default(400),
  // Jobs one worker runs at the same time.
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  // At most this many AI calls start per second (fal.ai rate limits). With Redis the limit is
  // shared by ALL workers, so adding workers never raises it; without Redis it's the API's own.
  AI_CALLS_PER_SECOND: z.coerce.number().int().min(1).max(100).default(10),
  // Tries per job, and the wait before the first retry (it doubles each time).
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().min(0).default(5000),
  // Time limits per job.
  TEXT_JOB_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
  IMAGE_JOB_TIMEOUT_MS: z.coerce.number().int().min(100).default(120_000),
}).refine((env) => env.NODE_ENV !== "production" || !!env.REDIS_URL, {
  path: ["REDIS_URL"],
  message: "is required in production: workers must run apart from the API (BE-07)",
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast at startup instead of crashing later with a confusing error.
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  isProduction: parsed.data.NODE_ENV === "production",
  mongodbUri: parsed.data.MONGODB_URI,
  // Which build is running: the deploy's version if set, otherwise package.json's.
  version: parsed.data.BUILD_VERSION ?? packageJson.version,
  logLevel: parsed.data.LOG_LEVEL,
  jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
  appUrl: parsed.data.APP_URL.replace(/\/$/, ""),
  consentTextVersion: parsed.data.CONSENT_TEXT_VERSION,
  trustProxyHops: parsed.data.TRUST_PROXY_HOPS,
  redisUrl: parsed.data.REDIS_URL ?? null,
  aiProvider: parsed.data.AI_PROVIDER,
  stubDelayMs: parsed.data.STUB_DELAY_MS,
  queue: {
    concurrency: parsed.data.QUEUE_CONCURRENCY,
    aiCallsPerSecond: parsed.data.AI_CALLS_PER_SECOND,
    attempts: parsed.data.JOB_ATTEMPTS,
    backoffMs: parsed.data.JOB_BACKOFF_MS,
    textTimeoutMs: parsed.data.TEXT_JOB_TIMEOUT_MS,
    imageTimeoutMs: parsed.data.IMAGE_JOB_TIMEOUT_MS,
  },
};
