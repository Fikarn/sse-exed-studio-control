// plan PR 6 / workstream D2: Vitest setup for the design-system component
// tests. Loads `@testing-library/jest-dom` so the component specs can use
// matchers like `toBeVisible()`, `toBeDisabled()`, `toHaveAttribute(...)`.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest config sets `globals: false`, which disables Testing Library's
// auto-cleanup. Without an explicit afterEach hook each test's rendered
// DOM (including portals to document.body — Dialog, ContextMenu, the
// CommandPalette overlay) accumulates and bleeds into the next test.
// Register cleanup once here so individual specs don't have to repeat it.
afterEach(() => {
  cleanup();
});
