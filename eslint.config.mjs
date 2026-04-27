import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// Initial baseline lint config. Intentionally permissive so the existing
// 17k-line frontend corpus and the build/release scripts pass; tighten in
// follow-up PRs after Phase 2 / Phase 3 splits.
//
// Notes:
// - `no-undef` is disabled globally because TypeScript already enforces it
//   for .ts/.tsx, and listing every Node/browser/Playwright global in flat
//   config is strictly worse than letting the type checker handle it.
// - `react/no-unescaped-entities` is disabled because it flags ordinary
//   straight quotes inside JSX text and there are plenty of those in the
//   shipping copy.
// - Auto-generated files (engine-client/src/generated, tokens/src/generated,
//   tauri-shell/gen) and build/release outputs are ignored.
export default [
  {
    ignores: [
      "**/dist/**",
      "**/storybook-static/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/node_modules/**",
      ".tools/**",
      "frontend/packages/engine-client/src/generated/**",
      "frontend/packages/tokens/src/generated/**",
      "native/target/**",
      "native/tauri-shell/gen/**",
      "release/**",
      "artifacts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: "19.2" } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
    },
  },
];
