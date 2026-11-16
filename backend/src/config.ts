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
};
