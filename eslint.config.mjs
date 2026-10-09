import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Node utilities and node:test files deliberately use the CommonJS format.
  { files: ["scripts/**/*.cjs", "test/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Electron shell is plain CommonJS.
    "desktop/**",
    // Release output (the built app) and the downloaded relay agent (scripts/release.sh).
    "dist-desktop/**",
    "vendor/**",
    ".scratch/**",
    ".data/**",
  ]),
]);

export default eslintConfig;
