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
  },
});
