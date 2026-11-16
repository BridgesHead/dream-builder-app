// ESLint = a spell-checker for code. It finds likely bugs (unused variables, forgotten
// awaits, ...) before they run. `pnpm --ignore-workspace lint` runs it; CI runs it on every PR.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Folders we don't check: installed packages, old code being replaced, PGlite's files.
  { ignores: ["node_modules/", "legacy/", "data/", "dist/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow unused arguments that start with "_" (e.g. `_req` when a handler doesn't need it).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
