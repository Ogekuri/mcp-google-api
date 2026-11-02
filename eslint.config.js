// ESLint flat configuration for mcp-google-map.
// Parser-only TypeScript setup (typescript-eslint base) plus a minimal,
// always-safe rule set: `npm run typecheck` (tsc --noEmit) remains the
// authoritative type gate; ESLint here backs the static-check tool with
// parsing support for every file under src/ and tests/.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  tseslint.configs.base,
  {
    files: ["**/*.ts"],
    rules: {
      "no-debugger": "error",
      "no-eval": "error",
    },
  }
);
