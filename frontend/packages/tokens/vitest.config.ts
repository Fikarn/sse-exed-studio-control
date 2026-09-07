import { defineConfig } from "vitest/config";

// Visual overhaul A, Slice 1: token-level tests (WCAG ratios computed from the
// token values themselves, before any render). Node environment; specs are
// colocated as `src/**/*.test.ts`.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
