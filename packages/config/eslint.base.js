// The shared ESLint rules (ESLint = a spell-checker for code: it finds likely bugs such as
// unused variables before they run). An app's eslint.config.js imports this and adds its own
// folders to ignore.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @param {{ ignores?: string[] }} [options] */
export function baseConfig(options = {}) {
  return tseslint.config(
    { ignores: ["node_modules/", "dist/", ...(options.ignores ?? [])] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      rules: {
        // Allow unused arguments that start with "_" (e.g. `_req` when a handler doesn't need it).
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      },
    },
  );
}
