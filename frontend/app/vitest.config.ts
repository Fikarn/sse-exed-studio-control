import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation for unit + component tests
// in the frontend/app workspace. Playwright still owns end-to-end specs
// (`tests/*.spec.ts`); Vitest picks up colocated `*.test.ts` / `*.test.tsx`
// files in src/.

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
    // `npm run test:coverage` measures on demand; nothing fails on the figure.
    // Every source file counts, whether a test loads it or not.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.stories.{ts,tsx}", "**/*.d.ts", "src/generated/**"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
