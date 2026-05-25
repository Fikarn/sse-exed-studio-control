import { expect, type Page } from "@playwright/test";
import type { AudioSnapshot } from "@sse/engine-client";
import { readFileSync } from "node:fs";

// plan PR 4 / workstream D4: shared fixture-loading helper. Every per-surface
// spec uses this to navigate to a fixture-backed instance of the operator
// shell. Planning fixtures freeze `page.clock` so relative-time labels
// stay stable across runs (mirrors what visual-review.spec.ts does).

export const FIXTURE_NOW = new Date("2026-04-23T09:11:00+02:00");

export const fixtureMap = JSON.parse(
  readFileSync(new URL("../../../packages/test-fixtures/src/fixtures.json", import.meta.url), "utf-8")
) as Record<string, { audioSnapshot?: AudioSnapshot }>;

export async function openFixture(page: Page, fixtureId: string, options?: { operatorReview?: "studio" }) {
  if (fixtureId.startsWith("planning-")) {
    await page.clock.setFixedTime(FIXTURE_NOW);
  }
  const params = new URLSearchParams({
    fixture: fixtureId,
    transport: "fixture",
  });
  if (options?.operatorReview) {
    params.set("operatorReview", options.operatorReview);
  }
  const response = await page.goto(`/?${params.toString()}`);
  expect(response, `fixture ${fixtureId} should return a document response`).not.toBeNull();
  expect(response!.status(), `fixture ${fixtureId} should not fail to load`).toBeLessThan(400);
  expect(page.url()).toContain(`fixture=${fixtureId}`);
}
