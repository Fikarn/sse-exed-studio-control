import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation. Engine-client unit
// coverage (transports, machines, store) lands in D3.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
