import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    "dist/**",
    "dist-desktop/**",
    "desktop/dist/**",
    "desktop/runtime/**",
    "desktop/vendor/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "data/**",
    "drizzle/**",
    "desktop/scripts/*.js",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
]);
