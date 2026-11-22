// =============================================================================
// eslint.config.mjs : CODE-STYLE CHECKER SETTINGS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Settings for ESLint, the tool that checks the code for mistakes and style problems when you run
//   `npx eslint`. It uses the rules that come with Next.js.
// =============================================================================

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
