import { expect, type Page } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";
import { readFileSync } from "node:fs";

// plan PR 4 / workstream D4: shared fixture-loading helper. Every per-surface
// spec uses this to navigate to a fixture-backed instance of the operator
// shell.

export const fixtureMap = JSON.parse(
  readFileSync(new URL("../../../packages/test-fixtures/src/fixtures.json", import.meta.url), "utf-8")
) as Record<string, { audioSnapshot?: AudioSnapshot }>;

export async function openFixture(
  page: Page,
  fixtureId: string,
  options?: {
    /** Slice 9: make this workspace throw while it renders (fixture double only). */
    crash?: "setup" | "lighting" | "audio";
    operatorReview?: "studio";
    theme?: "graphite" | "bone";
  }
) {
  const params = new URLSearchParams({
    fixture: fixtureId,
    transport: "fixture",
  });
  if (options?.theme) {
    params.set("theme", options.theme);
  }
  if (options?.operatorReview) {
    params.set("operatorReview", options.operatorReview);
  }
  if (options?.crash) {
    params.set("crash", options.crash);
  }
  const response = await page.goto(`/?${params.toString()}`);
  expect(response, `fixture ${fixtureId} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixtureId} should not fail to load`).toBeLessThan(400);
  expect(page.url()).toContain(`fixture=${fixtureId}`);
}

// Production readiness S14. Each workspace is a chunk of its own, fetched after
// the shell has drawn, so `openFixture` returning says nothing about whether
// the workspace is on screen. A key sent before it has mounted goes to nobody
// (S13 found two flakes of exactly that shape on the Console's loading
// surface). A spec whose first step is a key waits for the workspace first.
// Each mark is an element only the mounted workspace draws: never its loading
// surface, never the shell's `workspace-loading`.
const WORKSPACE_MARKS = {
  setup: "setup-workspace",
  lighting: "lighting-stage",
  audio: "audio-monitor-bar",
} as const;

export async function expectWorkspaceMounted(
  page: Page,
  workspace: keyof typeof WORKSPACE_MARKS,
  options?: { timeout?: number }
) {
  await expect(page.getByTestId(WORKSPACE_MARKS[workspace])).toBeVisible(options);
}
