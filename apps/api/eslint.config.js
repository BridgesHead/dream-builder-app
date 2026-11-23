// ESLint = a spell-checker for code. It finds likely bugs (unused variables, forgotten
// awaits, ...) before they run. `pnpm lint` runs it; CI runs it on every PR.
// The shared rules live in packages/config (eslint.base.js).
import { baseConfig } from "@dream-builder/config/eslint";

// Folders we don't check here: old code being replaced and the local data folder.
export default baseConfig({ ignores: ["legacy/", "data/"] });
