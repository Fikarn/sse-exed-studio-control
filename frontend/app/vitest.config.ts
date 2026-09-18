import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation for unit + component tests
// in the frontend/app workspace. Playwright still owns end-to-end specs
// (`tests/*.spec.ts`); Vitest picks up colocated `*.test.ts` / `*.test.tsx`
// files in src/. Subsequent plan PRs (D2, D3, D6) populate the suite.

export default defineConfig({
  // The app version is a Vite define (vite.config.ts); component tests that
  // render a surface printing it need the same symbol.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**"],
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
      thresholds: { statements: 6.75, branches: 5.79, functions: 6.01, lines: 6.89 },
    },
  },
});
