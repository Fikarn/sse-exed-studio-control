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
  },
});
