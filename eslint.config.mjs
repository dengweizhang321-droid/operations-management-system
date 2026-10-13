import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Frozen review harnesses use their original CommonJS loading protocol.
  // Keep them in the scan; only the incompatible ESM-style rule is adjusted.
  {
    files: [
      "docs/release-integration-review/c-acceptance-20261011/*.cjs",
      "docs/release-integration-review/c-final-independent-20261011/*.cjs",
      "docs/release-integration-review/c-targeted-independent-20261011/*.cjs",
      "docs/release-integration-review/c-unified-candidate-20261011/*.cjs",
    ],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["docs/startup-recovery-continuation-20261012/diagnose-exact-display.mjs"],
    // This immutable diagnostic is a Node script, not a Next.js application
    // module. Preserve its historical variable name and all other checks.
    rules: { "@next/next/no-assign-module-variable": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".runtime/**",
    "**/.venv/**",
    ".codex-tmp/**",
    ".vite-sites-cache/**",
    "tmp/**",
    "outputs/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
