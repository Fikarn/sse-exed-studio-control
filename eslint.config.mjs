import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

const reactRecommendedErrorRules = Object.fromEntries(
  Object.entries(eslintReact.configs.recommended.rules).filter(([, severity]) => severity === "error")
);

// Repo hygiene ratchet. Keep generated and local evidence output ignored, but
// make source-level cleanup categories fail fast instead of drifting as warnings.
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
      ".claude/worktrees/**",
      "**/.claude/worktrees/**",
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
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-object-type": "error",
    },
  },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    plugins: { "@eslint-react": eslintReact, "react-hooks": reactHooks },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { "react-x": { version: "19.2" } },
    rules: {
      ...reactRecommendedErrorRules,
      "@eslint-react/dom-no-unknown-property": "off",
      "@eslint-react/dom-no-unsafe-iframe-sandbox": "off",
      "@eslint-react/exhaustive-deps": "off",
      "@eslint-react/no-context-provider": "off",
      "@eslint-react/no-forward-ref": "off",
      "@eslint-react/rules-of-hooks": "off",
      "@eslint-react/static-components": "error",
      "@eslint-react/unsupported-syntax": "error",
      "@eslint-react/no-use-context": "off",
      "@eslint-react/use-memo": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
];
