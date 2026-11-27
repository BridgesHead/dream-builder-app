import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Settings used while tests run. They win over .env, because dotenv never
    // overwrites a variable that is already set.
    env: {
      NODE_ENV: "test",
      // A SEPARATE database just for tests, so tests can never wipe your dev data.
      // CI sets MONGODB_URI itself (to its MongoDB container); otherwise use the local one.
      MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/dream_builder_test",
      // A made-up key used only by tests. It protects nothing real.
      JWT_ACCESS_SECRET: "test-only-key-that-protects-nothing-real-000000",
      APP_URL: "http://localhost:5173",
      // Fast background jobs in tests (BE-07). CI also sets REDIS_URL, so there the real
      // BullMQ queue is tested; on a PC without Redis the in-memory queue is.
      STUB_DELAY_MS: "5",
      // Pinned, so a developer's .env (e.g. more tries for the free AI) never changes the tests.
      JOB_ATTEMPTS: "3",
      JOB_BACKOFF_MS: "10",
      TEXT_JOB_TIMEOUT_MS: "2000",
      IMAGE_JOB_TIMEOUT_MS: "2000",
      // Pictures go to a throw-away folder, never your dev pictures (BE-10). Tests never use
      // the real fal.ai or S3: the fal tests start their own fake fal.ai server.
      AI_PROVIDER: "stub",
      AI_TEXT_PROVIDER: "",
      AI_IMAGE_PROVIDER: "",
      STORAGE_DIR: path.join(os.tmpdir(), "dream-builder-test-storage"),
      S3_BUCKET: "",
      // No real AI keys in tests, even if your .env has them (the Gemini and Cloudflare tests
      // start their own fake servers too).
      FAL_KEY: "",
      GEMINI_API_KEY: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_API_TOKEN: "",
      // Payments (BE-17): never the real Stripe in tests. No key = the fake Stripe; webhooks are
      // signed with this made-up secret by the tests themselves (Stripe's own test helper).
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "whsec_test_only_secret_that_protects_nothing",
    },
    // Test files share one MongoDB; run them one after another so they don't step on each other.
    fileParallelism: false,
  },
});
