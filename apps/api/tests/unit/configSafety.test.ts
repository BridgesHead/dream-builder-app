// Safety settings in src/config.ts. The config stops the program when a setting is wrong, so
// each case runs it in its own process with made-up settings (no real keys anywhere).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../../", import.meta.url));

/** Loads the config with these settings; returns whether it started and what it printed. */
function loadConfig(env: Record<string, string>) {
  const out = spawnSync(process.execPath, ["--import", "tsx", "-e", 'await import("./src/config.ts"); console.log("CONFIG OK")'], {
    cwd: API,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      // dotenv never overrides what is set here, and .env isn't read for these keys.
      DOTENV_CONFIG_PATH: "does-not-exist.env",
      MONGODB_URI: "mongodb://127.0.0.1:27017/config_test",
      JWT_ACCESS_SECRET: "a-long-made-up-secret-for-the-config-test-only",
      ...env,
    },
    timeout: 30_000,
  });
  return { ok: out.stdout.includes("CONFIG OK"), output: `${out.stdout}\n${out.stderr}` };
}

const SERVER = { NODE_ENV: "production", REDIS_URL: "redis://127.0.0.1:6379", S3_BUCKET: "made-up-bucket" };
const FREE = { AI_TEXT_PROVIDER: "gemini", AI_IMAGE_PROVIDER: "cloudflare", GEMINI_API_KEY: "made-up-gemini-key", CLOUDFLARE_ACCOUNT_ID: "made-up-account", CLOUDFLARE_API_TOKEN: "made-up-cloudflare-token" };

describe("the free AI services never get real children's stories", () => {
  it("a server (NODE_ENV=production) refuses Gemini / Cloudflare", () => {
    const out = loadConfig({ ...SERVER, ...FREE });
    expect(out.ok).toBe(false);
    expect(out.output).toContain("AI_PROVIDER"); // the setting the error points at
  }, 40_000);

  it("unless a test server says so on purpose", () => {
    expect(loadConfig({ ...SERVER, ...FREE, ALLOW_FREE_AI: "true" }).ok).toBe(true);
  }, 40_000);

  it("a server on the stub (as production is now) starts as before", () => {
    expect(loadConfig({ ...SERVER, AI_PROVIDER: "stub" }).ok).toBe(true);
  }, 40_000);

  it("on a PC they work without the setting", () => {
    expect(loadConfig({ NODE_ENV: "development", ...FREE }).ok).toBe(true);
  }, 40_000);
});
