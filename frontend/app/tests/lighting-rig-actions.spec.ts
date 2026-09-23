import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// 2026-09-22, after the production readiness program. The fixture double
// answered eight of the rig's actions with `{}` and changed nothing: Identify,
// Highlight and Solo, Find and the Esc that ends it, Delete fixture, pinning a
// scene, and dragging a scene or a group in its rail. Each case below drives the
// screen and reads what the double then shows, so it fails if the double stops
// answering as the hardware link does (`native/rust-engine/src/lighting/`). The
// replies themselves are held field by field in
// `frontend/packages/engine-client/src/transports/fixture/lightingRequests.test.ts`.
//
// The stage plot's markers name each light's level as the hardware link reports
// it: "Fixture Key, 76 percent, 3200 kelvin, …", or "Fixture Back, off, …".
// Identify and Find last a set time, so those cases stop the page's clock and
// move it on by hand.

function marker(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^Fixture ${name}, `) });
}

async function selectFixture(page: Page, name: string, options: { additive?: boolean } = {}) {
  await marker(page, name).focus();
  await page.keyboard.press(options.additive ? "Shift+Enter" : "Enter");
}

async function openPopulatedRig(page: Page, options: { stopClock?: boolean } = {}) {
  if (options.stopClock) await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  if (options.stopClock) await pausePageClock(page);
}

// dnd-kit's keyboard drag, as an operator without a mouse does it: Space picks
// the item up, the arrow towards its neighbour moves it there, Space drops it.
// `neighbourId` is the neighbour's id in the rail, which is how dnd-kit names
// it to a screen reader.
async function keyboardDragOnto(page: Page, item: Locator, neighbour: Locator, neighbourId: string) {
  const from = await item.boundingBox();
  const to = await neighbour.boundingBox();
  if (!from || !to) throw new Error("both items must be on screen");
  const arrow =
    to.x < from.x - 1 ? "ArrowLeft" : to.x > from.x + 1 ? "ArrowRight" : to.y < from.y ? "ArrowUp" : "ArrowDown";
  await item.focus();
  await page.keyboard.press("Space");
  await expect(item).toHaveAttribute("data-dragging", "true");
  // The sensor starts listening for the arrow keys on a timer of its own
  // (`setTimeout` in dnd-kit's `KeyboardSensor.attach`); an arrow pressed
  // before that is lost. Timers of one delay run in the order they were set,
  // so once a timer queued now has fired, the sensor is listening.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.keyboard.press(arrow);
  // Which item the dragged one is over settles a render later; dropped before
  // that, it lands on itself. dnd-kit announces it to a screen reader once it
  // has settled, and that is the moment a drop lands on the neighbour.
  await expect(page.getByRole("status").filter({ hasText: `over droppable area ${neighbourId}.` })).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(item).not.toHaveAttribute("data-dragging", "true");
}

test("Identify lights the fixture until its burst ends (lighting.fixture.identify)", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  await selectFixture(page, "Back");
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);

  await page.getByRole("button", { name: "Identify", exact: true }).click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);

  // The burst lasts 1.2 s; the next read after it shows the light as stored.
  await page.clock.runFor(1_300);
  await selectFixture(page, "Key");
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);
});

test("Highlight and Solo hold as the hardware link reports them (lighting.fixture.highlight)", async ({ page }) => {
  await openPopulatedRig(page);
  const highlight = page.getByTestId("lighting-highlight-toggle");
  const solo = page.getByTestId("lighting-solo-toggle");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, 3200 kelvin, /);

  // Highlight: the selection at full level in open white.
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "true");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 100 percent, 4500 kelvin, /);
  await highlight.click();
  await expect(highlight).toHaveAttribute("aria-pressed", "false");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, 3200 kelvin, /);

  // Solo: everything outside the selection dark, the selection as it was.
  await solo.click();
  await expect(solo).toHaveAttribute("aria-pressed", "true");
  await expect(marker(page, "Fill")).toHaveAccessibleName(/^Fixture Fill, off, /);
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, /);
  await solo.click();
  await expect(solo).toHaveAttribute("aria-pressed", "false");
  await expect(marker(page, "Fill")).toHaveAccessibleName(/^Fixture Fill, 58 percent, /);
});

test("Find flashes the selected lights one after another (lighting.fixture.identifySequence)", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  // Key is selected when the rig opens; Back joins it, and flashes first.
  await selectFixture(page, "Back", { additive: true });
  await page.getByTestId("lighting-identify-find").click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, /);

  // Each light flashes 400 ms, the next one 500 ms after the one before.
  await page.clock.runFor(500);
  await selectFixture(page, "Fill");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 100 percent, /);
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);
});

test("Esc ends a Find sequence, the flashes still waiting included (lighting.fixture.identify.clearAll)", async ({
  page,
}) => {
  await openPopulatedRig(page, { stopClock: true });
  await selectFixture(page, "Back", { additive: true });
  await page.getByTestId("lighting-identify-find").click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);

  await page.keyboard.press("Escape");
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);
  await page.clock.runFor(500);
  await selectFixture(page, "Fill");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, /);
});

test("Delete fixture takes the light off the plot and out of every scene (lighting.fixture.delete)", async ({
  page,
}) => {
  await openPopulatedRig(page);
  const warmWash = page.getByRole("button", { name: /^Recall scene Warm wash/ });
  const interview = page.getByRole("button", { name: /^Recall scene Interview/ });
  await expect(warmWash).toContainText("3 on");
  await expect(interview).toContainText("4 on");

  await selectFixture(page, "Fill");
  await page.getByRole("button", { name: "Delete fixture", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete fixture?" })
    .getByRole("button", { name: "Delete fixture", exact: true })
    .click();

  await expect(marker(page, "Fill")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Fixture .+, (off|\d+ percent), / })).toHaveCount(3);
  await expect(warmWash).toContainText("2 on");
  await expect(interview).toContainText("3 on");
});

test("Pinning a scene shows it first, and unpinning puts it back (lighting.scene.pin)", async ({ page }) => {
  await openPopulatedRig(page);
  const tiles = page.getByLabel("Saved scenes").getByRole("button", { name: /^Recall scene / });
  await expect(tiles.first()).toHaveAccessibleName(/^Recall scene Warm wash/);

  await page.getByRole("button", { name: "Pin scene Interview", exact: true }).click();
  const unpin = page.getByRole("button", { name: "Unpin scene Interview", exact: true });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  await expect(tiles.first()).toHaveAccessibleName("Recall scene Interview, pinned");

  await unpin.click();
  await expect(tiles.first()).toHaveAccessibleName(/^Recall scene Warm wash/);
  await expect(tiles.nth(1)).toHaveAccessibleName("Recall scene Interview");
});

test("Dragging a scene reorders the scene rail (lighting.scene.reorder)", async ({ page }) => {
  await openPopulatedRig(page);
  const tiles = page.getByLabel("Saved scenes").getByRole("button", { name: /^Recall scene / });
  await expect(tiles.nth(1)).toHaveAccessibleName("Recall scene Interview");

  await keyboardDragOnto(
    page,
    page.getByRole("button", { name: "Recall scene Interview", exact: true }),
    page.getByRole("button", { name: /^Recall scene Warm wash/ }),
    "scene-warm-wash"
  );
  await expect(tiles.first()).toHaveAccessibleName("Recall scene Interview");
  await expect(tiles.nth(1)).toHaveAccessibleName(/^Recall scene Warm wash/);
});

// 2026-09-23: the double refused `grandMaster` (a finding recorded under
// `f29bbad`), so moving the Grand master against it showed "Grand master update
// failed." and a re-read put it back at 100 %. The page commits a move 200 ms
// after the last one (`useLightingRigControls.ts`), so the case moves the
// stopped clock past that, then leaves Lighting and comes back: the value on
// screen is then the one the double stored.
test("The Grand master is taken and kept (lighting.settings.update { grandMaster })", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  const readout = page.getByTestId("lighting-grand-master-readout");
  await expect(readout).toHaveText("100 %");

  await page.getByRole("slider", { name: "Grand master intensity" }).focus();
  await page.keyboard.press("Home");
  await expect(readout).toHaveText("0 %");
  await page.clock.runFor(250);
  await page.clock.resume();

  await page.keyboard.press("Control+1");
  await expectWorkspaceMounted(page, "setup");
  await page.keyboard.press("Control+2");
  await expectWorkspaceMounted(page, "lighting");
  await expect(page.getByTestId("lighting-grand-master-readout")).toHaveText("0 %");
  await expect(page.getByText("Grand master update failed.")).toHaveCount(0);
});

test("Dragging a group reorders the group rail (lighting.group.reorder)", async ({ page }) => {
  await openPopulatedRig(page);
  const chips = page
    .getByRole("list", { name: "Lighting groups" })
    .getByRole("button", { name: /\. Toggle (on|off)\.$/ });
  await expect(chips.first()).toHaveAccessibleName(/^Front, /);

  await keyboardDragOnto(page, chips.filter({ hasText: "Back" }), chips.filter({ hasText: "Front" }), "group-front");
  await expect(chips.first()).toHaveAccessibleName(/^Back, /);
  await expect(chips.nth(1)).toHaveAccessibleName(/^Front, /);
});
