import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation. Shared-graphics geometry
// and canvas helpers will be covered here in D3.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
