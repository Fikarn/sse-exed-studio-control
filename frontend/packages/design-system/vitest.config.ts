import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1 + plan PR 6 / workstream D2: Vitest foundation
// for design-system primitives. JSDOM environment + jest-dom matchers
// loaded via `vitest.setup.ts`. Specs are colocated as
// `components/__tests__/*.test.tsx`.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Production readiness S13 (finding F25): `npm run test:coverage` fails below
    // these floors. A floor is the figure measured when it was set, minus two
    // points — a ratchet against tests rotting away, not a target; raise it when
    // coverage rises (docs/DEVELOPMENT.md, "Coverage floors"). Every source file
    // counts, whether a test loads it or not.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.stories.{ts,tsx}", "**/*.d.ts", "src/generated/**"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { statements: 50.18, branches: 54.85, functions: 51.38, lines: 52.32 },
    },
  },
});
