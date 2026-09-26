import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// 2026-09-22, after the production readiness program. The fixture double
// answered eight of the rig's actions with `{}` and changed nothing: Identify,
// Highlight and Solo, Find and the Esc that ended it (the Find key's Stop since
// the new pages program's Slice 3), Delete fixture, pinning a scene, and
// dragging a scene or a group in its rail. Each case below drives the screen
// and reads what the double then shows, so it fails if the double stops
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

// New pages program, Slice 3 (decision 10): the plot toolbar's Add to selection
// key, lit or not. It replaced Shift+Enter (and Shift+click) for adding a
// fixture to the selection.
async function setAddToSelection(page: Page, lit: boolean) {
  const toggle = page.getByTestId("lighting-add-to-selection");
  if ((await toggle.getAttribute("aria-pressed")) !== String(lit)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", String(lit));
}

// A selection lands a render after the key: the store asks the double, the
// reply comes back and the page draws it. A click sent at once can reach the
// page first (a browser handles input before pending work), and Identify or
// Find then act on the selection before it — so wait for the marker to say it
// is selected (2026-09-25: "each flash start and end" failed 4 runs in 30 on
// the workstation, Find running over Key alone; the ledger's Found, fixed).
// New pages program, Slice 3 (decision 10). Old: `additive` pressed
// Shift+Enter on the focused marker. New: it lights Add to selection and presses
// Enter, then puts the key out, so the next plain select selects one fixture.
async function selectFixture(page: Page, name: string, options: { additive?: boolean } = {}) {
  await setAddToSelection(page, options.additive ?? false);
  await marker(page, name).focus();
  await page.keyboard.press("Enter");
  await expect(marker(page, name)).toHaveAttribute("aria-pressed", "true");
  if (options.additive) await setAddToSelection(page, false);
}

// A plain click on a marker's body (no key held), where the plot draws it.
async function clickMarker(page: Page, name: string) {
  const target = marker(page, name);
  const box = await target.boundingBox();
  if (!box) throw new Error(`the ${name} marker must be on screen`);
  const center = await target.evaluate((node) => {
    const body = node.querySelector("g[filter]");
    if (!(body instanceof SVGGraphicsElement)) throw new Error("Fixture marker body not found");
    const matrix = body.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");
    return { x: matrix.e, y: matrix.f };
  });
  await target.click({ position: { x: center.x - box.x, y: center.y - box.y } });
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

// New pages program, Slice 3 (decision 6). Old: "Esc ends a Find sequence…" —
// the page-wide Esc stopped it. New: while a Find runs its key reads "Stop", and
// pressing it stops the sequence. Reason: the page-wide Esc went; nothing else
// on screen stopped a Find.
test("Stop ends a Find sequence, the flashes still waiting included (lighting.fixture.identify.clearAll)", async ({
  page,
}) => {
  await openPopulatedRig(page, { stopClock: true });
  await selectFixture(page, "Back", { additive: true });
  const find = page.getByTestId("lighting-identify-find");
  await expect(find).toHaveText("Find");
  await find.click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);
  await expect(find).toHaveText("Stop");

  await find.click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);
  await expect(find).toHaveText("Find");
  await page.clock.runFor(500);
  await selectFixture(page, "Fill");
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 76 percent, /);
});

// New pages program, Slice 3 (decision 6): the key reads "Stop" only while the
// flashes run — Find again once the last one has ended.
test("The Find key reads Stop while a Find runs and Find once its last flash ends", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  await selectFixture(page, "Back", { additive: true });
  const find = page.getByTestId("lighting-identify-find");
  await find.click();
  await expect(find).toHaveText("Stop");

  // Back flashes at 0 ms and Key at 500 ms, each for 400 ms: the last ends at 900 ms.
  await page.clock.runFor(800);
  await expect(find).toHaveText("Stop");
  await page.clock.runFor(200);
  await expect(find).toHaveText("Find");
});

// 2026-09-23 (a finding recorded 2026-09-22 under `a598b11`): nothing read the
// rig again when a flash ended, so the page went on showing it until something
// else refreshed Lighting — the cases above select another light to force that
// read. The store now reads again as each flash starts and ends, a little after
// the moment (`identifyFlashes.ts`); here nothing else is pressed.
test("The page shows each flash start and end by itself: Identify, then Find", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  await selectFixture(page, "Back");
  await page.getByRole("button", { name: "Identify", exact: true }).click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);
  await page.clock.runFor(1_300);
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);

  // Find over Key and Back: as in the Find case above, Back (added last)
  // flashes first, 400 ms, and Key 500 ms after it.
  await selectFixture(page, "Key");
  await selectFixture(page, "Back", { additive: true });
  await page.getByTestId("lighting-identify-find").click();
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, 100 percent, /);
  await page.clock.runFor(560);
  await expect(marker(page, "Back")).toHaveAccessibleName(/^Fixture Back, off, /);
  await expect(marker(page, "Key")).toHaveAccessibleName(/^Fixture Key, 100 percent, /);
  await page.clock.runFor(500);
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
// `f29bbad`), so moving the Grand master against it put up an error toast
// with its refusal ("lighting.settings.update requires one or more supported
// fields") and a re-read put the master back at 100 %. The page commits a move
// 200 ms after the last one (`useLightingRigControls.ts`), so the case moves
// the stopped clock past that, then leaves Lighting and comes back: the value
// on screen is then the one the double stored, and no error toast is up.
test("The Grand master is taken and kept (lighting.settings.update { grandMaster })", async ({ page }) => {
  await openPopulatedRig(page, { stopClock: true });
  const readout = page.getByTestId("lighting-grand-master-readout");
  await expect(readout).toHaveText("100 %");

  await page.getByRole("slider", { name: "Grand master intensity" }).focus();
  await page.keyboard.press("Home");
  await expect(readout).toHaveText("0 %");
  await page.clock.runFor(250);
  await page.clock.resume();

  // New pages program, Slice 3 (D6). Old: Ctrl+1 and Ctrl+2 went to Setup and
  // back. New: the header's tabs. Reason: the workspace keys are gone; the tabs
  // are their twins.
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("button", { name: "Setup / Support", exact: true }).click();
  await expectWorkspaceMounted(page, "setup");
  await nav.getByRole("button", { name: "Lighting", exact: true }).click();
  await expectWorkspaceMounted(page, "lighting");
  await expect(page.getByTestId("lighting-grand-master-readout")).toHaveText("0 %");
  // An error toast stays until it is dismissed (`toastContext.tsx`) and is the
  // design system's alert (`Toast.tsx`: role "alert", tone "error").
  await expect(page.locator('[role="alert"][data-tone="error"]')).toHaveCount(0);
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

// New pages program, Slice 3 (decision 5). Ctrl+Z undid the newest of the last
// 25 steps — Save scene, Delete scene, Add fixture, Delete fixture — and only a
// step's own message offered an Undo, for as long as it showed. The Rig
// section's Undo key does it now; its small print names the step it will undo.
test("The Undo key names the step it will undo and undoes it; with nothing to undo it cannot be pressed", async ({
  page,
}) => {
  await openPopulatedRig(page);
  const undo = page.getByTestId("lighting-undo");
  await expect(undo).toBeDisabled();
  await expect(undo).toContainText("nothing to undo");

  const interview = page.getByRole("button", { name: /^Recall scene Interview/ });
  await interview.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete scene/ }).click();
  await page.getByRole("dialog", { name: "Delete scene?" }).getByRole("button", { name: "Delete scene" }).click();
  await expect(interview).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await expect(undo).toContainText("Delete scene Interview");
  await expect(undo).toHaveAccessibleName("Undo Delete scene Interview");

  await undo.click();
  await expect(page.getByText("Undid ‘Delete scene Interview’.")).toBeVisible();
  await expect(interview).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(undo).toContainText("nothing to undo");
});

// New pages program, Slice 3 (decision 5): the message after adding a fixture
// has an Undo, as those of Save scene, Delete scene and Delete fixture have.
// Adding a fixture puts it, off, into every scene there is (the hardware link's
// `append_fixture_to_scenes`, and the double's create); that is not a scene
// saved with it, so it does not stop the undo.
test("The message after Add fixture has an Undo that takes the fixture off again (lighting.fixture.create)", async ({
  page,
}) => {
  await openPopulatedRig(page);
  const markers = page.getByRole("button", { name: /^Fixture .+, (off|\d+ percent), / });
  await expect(markers).toHaveCount(4);

  await page.getByTestId("lighting-add-fixture").click();
  const dialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Fixture 1");
  await dialog.getByRole("button", { name: "Add fixture" }).click();
  await expect(marker(page, "Fixture 1")).toBeVisible();
  await expect(page.getByText(/Lighting fixture 'Fixture 1' was created/)).toBeVisible();

  // The message's own Undo, named exactly: the Undo key is named for its step.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Undid ‘Add fixture Fixture 1’.")).toBeVisible();
  await expect(marker(page, "Fixture 1")).toHaveCount(0);
  await expect(markers).toHaveCount(4);
});

// New pages program, Slice 3 (decision 10). Shift+click on a marker added a
// fixture to the selection or took it out, and no other control added a single
// fixture. The plot toolbar's Add to selection key does it with a plain click;
// put out, a plain click selects that fixture alone, as it always did.
test("Add to selection adds a fixture with a plain click and takes it out with another", async ({ page }) => {
  await openPopulatedRig(page);
  const selection = page.getByLabel("Selected fixtures", { exact: true });
  await expect(marker(page, "Key")).toHaveAttribute("aria-pressed", "true");
  await setAddToSelection(page, true);

  await clickMarker(page, "Fill");
  await expect(marker(page, "Fill")).toHaveAttribute("aria-pressed", "true");
  await expect(marker(page, "Key")).toHaveAttribute("aria-pressed", "true");
  await expect(selection.getByText("2 fixtures selected")).toBeVisible();

  await clickMarker(page, "Fill");
  await expect(marker(page, "Fill")).toHaveAttribute("aria-pressed", "false");
  await expect(marker(page, "Key")).toHaveAttribute("aria-pressed", "true");
  await expect(selection.getByText("1 fixture selected")).toBeVisible();

  await setAddToSelection(page, false);
  await clickMarker(page, "Fill");
  await expect(marker(page, "Fill")).toHaveAttribute("aria-pressed", "true");
  await expect(marker(page, "Key")).toHaveAttribute("aria-pressed", "false");
});
