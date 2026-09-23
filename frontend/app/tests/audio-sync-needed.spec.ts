import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// 2026-09-23, the operator's decision (option D, with these words). The probe
// has passed and TotalMix meters are arriving, but the desk has not been read
// since the link changed, so the Console holds the meters still until a Sync
// confirms the desk. The state display used to read VERIFIED with still meters
// and no key; it now reads SYNC NEEDED, says why, and offers the one press
// that reads the desk. The scenario is built in `@sse/test-fixtures`
// (`audio-probe-passed-unsynced`): TotalMix metering, the console confidence
// `unknown`.

test("SYNC NEEDED says why the meters wait, and its Sync from TotalMix lets them move", async ({ page }) => {
  await openFixture(page, "audio-probe-passed-unsynced");
  await expectWorkspaceMounted(page, "audio");
  const display = page.getByTestId("audio-state-display");
  const workspace = page.getByTestId("audio-workspace");

  await expect(display).toContainText("SYNC NEEDED");
  await expect(display).toContainText(
    "The desk has not been read since the link changed, so the meters wait. Press Sync from TotalMix — it reads the desk and changes nothing."
  );
  await expect(workspace).toHaveAttribute("data-canvas-metering", "false");

  await display.getByTestId("audio-state-sync").click();

  await expect(display).toContainText("VERIFIED");
  await expect(display).not.toContainText("SYNC NEEDED");
  await expect(display.getByTestId("audio-state-sync")).toHaveCount(0);
  await expect(workspace).toHaveAttribute("data-canvas-metering", "true");
});
