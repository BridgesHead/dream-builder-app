import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";

// The "version" field from package.json, e.g. "1.0.0".
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

// An empty value (FAL_KEY=) counts as not set.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

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
  // Who makes the text and pictures: "fal" = the real AI (BE-10), "stub" = fake placeholders
  // (tests, and your PC without a fal.ai key).
  AI_PROVIDER: z.enum(["stub", "fal"]).default("stub"),
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

  // ---- fal.ai (BE-10) ----
  // The secret key from fal.ai. Only in .env or the AWS secret store; never printed or logged.
  FAL_KEY: unsetIfEmpty(z.string().min(10)),
  // Where fal.ai lives. Tests point this at a fake fal.ai server on the PC.
  FAL_BASE_URL: z.url().default("https://fal.run"),
  // The text endpoint (guide: fal-ai/any-llm) and the model behind it. The PRD's
  // Gemini Flash 1.5 is retired; Sami Bhai confirms the replacement (decision 1A).
  FAL_TEXT_ENDPOINT: z.string().min(1).default("fal-ai/any-llm"),
  FAL_TEXT_MODEL: z.string().min(1).default("google/gemini-2.5-flash"),
  // The FLUX picture model (decision 2A).
  FAL_IMAGE_MODEL: z.string().min(1).default("fal-ai/flux/dev"),
  // One fal.ai call gives up after this long, so a stuck call can't hold a worker.
  FAL_CALL_TIMEOUT_MS: z.coerce.number().int().min(100).default(50_000),

  // ---- Picture storage (BE-10) ----
  // The S3 bucket in the AWS UAE region. Set: pictures go to S3. Not set: a local folder
  // (STORAGE_DIR), for your PC only. AWS credentials come from the server's IAM role.
  S3_BUCKET: unsetIfEmpty(z.string().min(3)),
  S3_REGION: z.string().min(1).default("me-central-1"),
  STORAGE_DIR: z.string().min(1).default("data/storage"),
  // How long a picture link given to the app keeps working.
  IMAGE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(3600),
  // The API's own public address, for picture links to the local folder.
  API_URL: z.url().default("http://localhost:3000"),

  // ---- Draft review (BE-12) ----
  // How many new pictures one story may ask for (each costs a fal.ai call). Failed ones don't count.
  REDRAWS_PER_STORY: z.coerce.number().int().min(0).max(100).default(5),
  // The Creator-mode sentence rewriter: the longest sentence it may give back, and how many
  // times it asks the AI before giving up. Sami Bhai confirms the real word limit.
  REWRITE_MAX_WORDS: z.coerce.number().int().min(3).max(100).default(25),
  REWRITE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  // ---- Payments: Stripe Checkout (BE-17) ----
  // The secret key from the Stripe dashboard (Developers → API keys). Test keys (sk_test_) on
  // your PC, dev and staging; a live key (sk_live_) only in production. Never logged.
  STRIPE_SECRET_KEY: unsetIfEmpty(z.string().regex(/^(sk|rk)_(test|live)_/, "must be a Stripe secret key (sk_test_… or sk_live_…)")),
  // Checks that a webhook really came from Stripe. From "stripe listen" (your PC) or the
  // webhook's page in the Stripe dashboard (dev, staging, production).
  STRIPE_WEBHOOK_SECRET: unsetIfEmpty(z.string().regex(/^whsec_/, "must start with whsec_")),
  // Prices in AED, set by Dina. NEVER taken from the browser. Placeholders until Dina confirms.
  PRICE_DIGITAL_AED: z.coerce.number().positive().max(10_000).default(49),
  PRICE_HARDBACK_AED: z.coerce.number().positive().max(10_000).default(149),
  // Delivery for a hardback, added to its price (0 = included).
  DELIVERY_HARDBACK_AED: z.coerce.number().min(0).max(10_000).default(0),
  // How long Stripe's payment page stays open (Stripe allows 30 minutes to 24 hours).
  CHECKOUT_EXPIRES_MINUTES: z.coerce.number().int().min(30).max(24 * 60).default(60),
})
  .refine((env) => env.NODE_ENV !== "production" || !!env.REDIS_URL, {
    path: ["REDIS_URL"],
    message: "is required in production: workers must run apart from the API (BE-07)",
  })
  .refine((env) => env.NODE_ENV !== "production" || !!env.S3_BUCKET, {
    path: ["S3_BUCKET"],
    message: "is required in production: pictures live in the UAE bucket (BE-10)",
  })
  .refine((env) => env.AI_PROVIDER !== "fal" || !!env.FAL_KEY, {
    path: ["FAL_KEY"],
    message: 'is required when AI_PROVIDER is "fal"',
  })
  // Real money only in production: a live key anywhere else is a mistake.
  .refine((env) => env.NODE_ENV === "production" || !env.STRIPE_SECRET_KEY?.includes("_live_"), {
    path: ["STRIPE_SECRET_KEY"],
    message: "is a LIVE key: use a test key (sk_test_…) outside production",
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
  fal: {
    key: parsed.data.FAL_KEY ?? null,
    baseUrl: parsed.data.FAL_BASE_URL.replace(/\/$/, ""),
    textEndpoint: parsed.data.FAL_TEXT_ENDPOINT,
    textModel: parsed.data.FAL_TEXT_MODEL,
    imageModel: parsed.data.FAL_IMAGE_MODEL,
    callTimeoutMs: parsed.data.FAL_CALL_TIMEOUT_MS,
  },
  storage: {
    bucket: parsed.data.S3_BUCKET ?? null,
    region: parsed.data.S3_REGION,
    dir: parsed.data.STORAGE_DIR,
    urlTtlSeconds: parsed.data.IMAGE_URL_TTL_SECONDS,
    apiUrl: parsed.data.API_URL.replace(/\/$/, ""),
  },
  queue: {
    concurrency: parsed.data.QUEUE_CONCURRENCY,
    aiCallsPerSecond: parsed.data.AI_CALLS_PER_SECOND,
    attempts: parsed.data.JOB_ATTEMPTS,
    backoffMs: parsed.data.JOB_BACKOFF_MS,
    textTimeoutMs: parsed.data.TEXT_JOB_TIMEOUT_MS,
    imageTimeoutMs: parsed.data.IMAGE_JOB_TIMEOUT_MS,
  },
  payments: {
    stripeSecretKey: parsed.data.STRIPE_SECRET_KEY ?? null,
    stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET ?? null,
    // In AED, per book type. The server's prices are the only prices (BE-17).
    prices: { digital: parsed.data.PRICE_DIGITAL_AED, hardback: parsed.data.PRICE_HARDBACK_AED },
    delivery: { digital: 0, hardback: parsed.data.DELIVERY_HARDBACK_AED },
    checkoutExpiresMinutes: parsed.data.CHECKOUT_EXPIRES_MINUTES,
  },
  review: {
    redrawsPerStory: parsed.data.REDRAWS_PER_STORY,
    rewriteMaxWords: parsed.data.REWRITE_MAX_WORDS,
    rewriteAttempts: parsed.data.REWRITE_ATTEMPTS,
  },
};
