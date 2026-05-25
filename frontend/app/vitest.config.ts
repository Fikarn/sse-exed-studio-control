import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation for unit + component tests
// in the frontend/app workspace. Playwright still owns end-to-end specs
// (`tests/*.spec.ts`); Vitest picks up colocated `*.test.ts` / `*.test.tsx`
// files in src/. Subsequent plan PRs (D2, D3, D6) populate the suite.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**"],
  },
});
