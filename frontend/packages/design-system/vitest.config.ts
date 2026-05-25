import { defineConfig } from "vitest/config";

// plan PR 4 / workstream D1: Vitest foundation. design-system components
// will be exercised here via @testing-library/react in D2.

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
