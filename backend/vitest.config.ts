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
    },
    // Test files share one MongoDB; run them one after another so they don't step on each other.
    fileParallelism: false,
  },
});
