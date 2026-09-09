import { expect, test } from "@playwright/test";

import { expectNoDocumentScroll } from "./helpers/geometry";
import { expectToolbarPrimaryControlsFit } from "./helpers/lighting";
import { modifierShortcut } from "./helpers/modifier-shortcut";
import { openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: lighting workspace specs split out of
// operator-shell.spec.ts. Covers the snapshot loading posture, fixture
// snapshot rendering, layout responsiveness across viewport sizes,
// scaled-studio-preview entry, preview mode, palette pools, patch mode,
// view bookmarks, drag-lasso multi-select, fixture nudge/drag/rotate,
// DMX monitor expand, and DMX-unreachable + blackout posture.

test("renders the lighting snapshot loading posture", async ({ page }) => {
  await openFixture(page, "lighting-loading");

  const workspace = page.getByRole("main").first();
  // Visual overhaul A, Slice 5. Old: the Lighting workspace toolbar. New: the
  // shell's cluster, which carries what the toolbar carried and the rig's state
  // above it. Reason: Lighting follows the cluster rule — the state first and
  // fixed, then the keys, in the same place as every other workspace.
  await expect(page.getByTestId("lighting-cluster")).toBeVisible();
  // Visual overhaul A, Slice 5: the scenes are the cluster's, outside the
  // workspace's own main element.
  await expect(page.getByTestId("lighting-cluster").getByText("No scenes saved yet")).toBeVisible();
  await expect(workspace.getByText("No fixtures on the rig yet")).toBeVisible();
  // Visual overhaul A, Slice 5: how many fixtures are patched is a footer item.
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("0 / 0 patched");
  await expect(page.getByRole("button", { name: /Fixture /i })).toHaveCount(0);
});

test("renders the lighting workspace from an engine-backed fixture snapshot", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  // Visual overhaul A, Slice 5. Old: the Lighting workspace toolbar. New: the
  // shell's cluster, which carries what the toolbar carried and the rig's state
  // above it. Reason: Lighting follows the cluster rule — the state first and
  // fixed, then the keys, in the same place as every other workspace.
  await expect(page.getByTestId("lighting-cluster")).toBeVisible();
  // Visual overhaul A, Slice 5 said "192.168.1.80 · universe 1" — the footer in
  // words. Slice 8 takes it back to "192.168.1.80 · U1": system §9 fixes the
  // universe's form as U1, the plate and Setup both print it that way, and one
  // fact should not have two forms on one screen.
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("192.168.1.80 · U1");
  await expect(workspace.getByText("Warm wash").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(page.getByRole("button", { name: "Recall scene Interview" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Lighting stage plot" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fixture Key, 76 percent, 3200 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(workspace.getByText("1 fixture selected")).toBeVisible();
  // Visual overhaul A, Slice 5. Old: the health bar's "Scene state" cell. New:
  // the footer's Scene item and the state display's word. Reason: the footer is
  // the shell's, and whether the rig matches the scene is a state, so it is in
  // the state display too.
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("Scene");
  await expect(page.getByTestId("lighting-state-display")).toContainText("REACHABLE");
  // Visual overhaul A, Slice 5. Old: the health bar's "Saved" cell. New: the
  // shell footer's Scene item says "saved". Reason: the footer is the shell's.
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("saved");
  await expect(page.getByRole("img", { name: "Scene intensity shape for Warm wash" })).toBeVisible();

  await page.keyboard.press("KeyS");
  await expect(page.getByRole("button", { name: "Recall scene Scene 3" })).toBeVisible();
  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(
    page.getByRole("application", { name: "Lighting stage plot" }).getByText("Interview", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Fixture Key, 92 percent, 4400 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await page.getByLabel("Fixture intensity").focus();
  await page.getByLabel("Fixture intensity").press("End");
  await expect(page.getByLabel("Fixture intensity")).toHaveAttribute("aria-valuenow", "100");
  await page.getByLabel("Fixture CCT").focus();
  await page.getByLabel("Fixture CCT").press("End");
  await expect(page.getByLabel("Fixture CCT")).toHaveAttribute("aria-valuenow", "5600");

  await page.getByRole("button", { name: /^Fixture Warm wash,/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Fixture Warm wash,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("Lighting inspector — Fixture").getByText("Apollo Bridge", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Warm wash, off,/ })).toHaveAttribute("aria-pressed", "true");

  // Visual overhaul A, Slice 5b. Old: inspect the group, then click the Group
  // tab. New: the plate shows what is selected, so inspecting the group is
  // enough. Reason: the plate has no tab row.
  await page.getByRole("button", { name: "Inspect Front group" }).click();
  await expect(page.getByRole("heading", { name: "Group" })).toBeVisible();
  // Visual overhaul A, Slice 5b: the group's own section is the plate's, which
  // sits beside the plot rather than inside it.
  await expect(page.getByTestId("lighting-plate").getByText("Front", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Turn group off" }).click();
  await expect(page.getByRole("button", { name: /Front, 2 fixtures.*off\. Toggle on\./i })).toBeVisible();
});

test("renders lighting fixture symbol families and stage plot render modes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "lighting-symbol-families");

  const plot = page.getByRole("application", { name: "Lighting stage plot" });
  await expect(plot.locator('[data-fixture-id="fixture-key"] [data-symbol-kind="panel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-soft-mat"] [data-symbol-kind="soft-mat"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-back"] [data-symbol-kind="linear-bar"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-fresnel"] [data-symbol-kind="fresnel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-kicker"] [data-symbol-kind="control-node"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-output-id="fixture-kicker"]')).toHaveCount(0);

  await page.getByRole("radio", { name: "Coverage" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "coverage");
  await page.getByRole("radio", { name: "Photometric" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "photometric");
  await expect(plot.locator('[data-fixture-output-id="fixture-back"]')).toHaveText(/593 lx @ 1 m|120 deg est\./);
  await page.getByRole("radio", { name: "Pixel" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "pixel");
  expect(await plot.locator('[data-fixture-id="fixture-back"] [data-emitter-segment="true"]').count()).toBeGreaterThan(
    0
  );

  const symbolKey = page.getByTestId("fixture-symbol-key");
  await expect(symbolKey).toBeVisible();
  await expect(page.getByTestId("fixture-symbol-key-row-litepanels-astra-bicolor")).toContainText("2");
  await expect(page.getByTestId("fixture-symbol-key-row-aputure-infinibar-pb12")).toContainText("8 ch");

  const fresnel = page.getByRole("button", { name: /^Fixture Fresnel,/ });
  await fresnel.focus();
  await page.keyboard.press("Enter");
  await expect(fresnel).toHaveAttribute("aria-pressed", "true");
});

test("keeps the full lighting workspace visible at the 1920x1080 fallback size", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFixture(page, "lighting-populated");

  const workspace = page.getByRole("main").first();
  // Visual overhaul A, Slice 5. Old: the Lighting workspace toolbar. New: the
  // shell's cluster, which carries what the toolbar carried and the rig's state
  // above it. Reason: Lighting follows the cluster rule — the state first and
  // fixed, then the keys, in the same place as every other workspace.
  await expect(page.getByTestId("lighting-cluster")).toBeVisible();
  // The scenes and the groups are the cluster's sections now, so they are read
  // off the cluster rather than the workspace's own main element.
  const cluster = page.getByTestId("lighting-cluster");
  await expect(cluster.getByText("Scenes", { exact: true })).toBeVisible();
  await expect(cluster.getByText("Groups", { exact: true })).toBeVisible();
  await expect(page.getByRole("application", { name: "Lighting stage plot" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Patch/ })).toBeVisible();
  await expect(workspace.getByText("1 fixture selected")).toBeVisible();

  const layoutMetrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));

  expect(layoutMetrics.scrollHeight).toBeLessThanOrEqual(layoutMetrics.viewportHeight + 1);
  expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(layoutMetrics.viewportWidth + 1);
});

test("adapts lighting layout modes across supported logical viewport sizes", async ({ page }) => {
  const cases = [
    { width: 1280, height: 800, mode: "narrowUtility" },
    { width: 1440, height: 900, mode: "desktopCompact" },
    { width: 1600, height: 960, mode: "desktopCompact" },
    { width: 1728, height: 1117, mode: "desktopCompact" },
    { width: 1920, height: 1080, mode: "studioFull" },
    { width: 2560, height: 1440, mode: "studioFull" },
  ] as const;

  for (const entry of cases) {
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await openFixture(page, "lighting-populated");

    await expect(page.locator("[data-operator-layout-root]")).toHaveAttribute("data-layout-mode", entry.mode);
    await expect(page.getByTestId("lighting-cluster")).toBeVisible();
    await expect(page.getByTestId("lighting-stage")).toBeVisible();
    await expectToolbarPrimaryControlsFit(page);
    await expectNoDocumentScroll(page);

    const stageBounds = await page.getByTestId("lighting-stage").boundingBox();
    expect(stageBounds?.width ?? 0).toBeGreaterThanOrEqual(entry.mode === "narrowUtility" ? 520 : 560);
    expect(stageBounds?.height ?? 0).toBeGreaterThanOrEqual(entry.mode === "narrowUtility" ? 400 : 440);

    // Visual overhaul A, Slice 5. Old: below the studio surface the selection's
    // tools folded into a toolbar overflow menu. New: Highlight, Solo and Find
    // are keys on the cluster at every size. Reason: the cluster carries the
    // rig's standing actions, and it is the same cluster at every size.
    await expect(page.getByTestId("lighting-highlight-toggle")).toBeVisible();
    await expect(page.getByTestId("lighting-solo-toggle")).toBeVisible();
    await expect(page.getByTestId("lighting-identify-find")).toBeVisible();

    if (entry.mode === "narrowUtility") {
      await expect(page.getByTestId("lighting-inspector-drawer")).toHaveCount(0);
      await page.getByTestId("lighting-open-inspector").click();
      await expect(page.getByTestId("lighting-inspector-drawer")).toBeVisible();
      await expect(page.getByTestId("lighting-inspector-drawer").getByLabel("Fixture intensity")).toBeVisible();
      await page.getByTestId("lighting-inspector-drawer").getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("lighting-inspector-drawer")).toHaveCount(0);
    }
  }
});

// Visual overhaul A, Slice 5 (plan Slice 5, findings M3 and C3): when the
// bridge is not answering, the rig's writes are refused — so every rig control
// is outlined and says why, the plot says so on its face, and the header lamp
// is red.
test("unreachable: the state display carries the bridge sentence, the rig is outlined and the header lamp is red", async ({
  page,
}) => {
  await openFixture(page, "lighting-dmx-unreachable");

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("UNREACHABLE");
  await expect(stateDisplay).toHaveAttribute("data-tone", "error");
  await expect(stateDisplay).toContainText(/is not answering/i);
  await expect(page.getByTestId("lighting-state-setup")).toBeVisible();
  await expect(page.getByTestId("shell-lamp-lighting")).toHaveAttribute("data-tone", "error");

  for (const testId of ["lighting-power-toggle", "lighting-emergency-cut", "lighting-grand-master"]) {
    const control = page.getByTestId(testId);
    await expect(control, `${testId} refuses`).toHaveAttribute("aria-disabled", "true");
    // A locked key is dashed on its own edge; a locked slider keeps its
    // geometry and dashes the cap the hand would take hold of.
    const dashed = await control.evaluate((node) => {
      if (getComputedStyle(node).borderStyle === "dashed") return true;
      return Array.from(node.querySelectorAll("*")).some((child) => getComputedStyle(child).borderStyle === "dashed");
    });
    expect(dashed, `${testId} is outlined while the rig refuses`).toBe(true);
  }

  await expect(page.getByTestId("lighting-stage")).toHaveAttribute("data-locked", "");
  await expect(page.getByTestId("lighting-stage-lock-note")).toHaveText(
    "locked · the bridge is not answering · Open Setup"
  );
});

// Visual overhaul A, Slice 5: the rig has drifted from the scene it was
// recalled from — the state display says so and offers both ways back.
test("unsaved: the state display says the rig no longer matches the scene and offers both ways back", async ({
  page,
}) => {
  await openFixture(page, "lighting-populated");
  await page.getByRole("button", { name: /^Front, 2 fixtures/ }).click();

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("UNSAVED");
  await expect(stateDisplay).toHaveAttribute("data-tone", "attention");
  await expect(stateDisplay).toContainText(/no longer matches/i);
  await expect(page.getByTestId("lighting-state-save")).toBeVisible();
  await expect(page.getByTestId("lighting-state-revert")).toBeVisible();
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("unsaved changes");
});

// Visual overhaul A, Slice 5: editing offline is a state, not a banner — the
// plot carries the blue keyline and the display offers the two ways out.
test("preview: the plot carries the blue keyline and the state display offers save or discard", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await page.getByTestId("lighting-preview-toggle").click();

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("PREVIEW");
  await expect(stateDisplay).toHaveAttribute("data-tone", "info");
  await expect(page.getByTestId("lighting-state-preview-save")).toBeVisible();
  await expect(page.getByTestId("lighting-state-preview-discard")).toBeVisible();
  await expect(page.getByTestId("lighting-stage")).toHaveAttribute("data-preview", "");
});

// Visual overhaul A, Slice 5b (plan Slice 5, the plate): the selected fixture's
// whole story at once — what it is, Identify and on / off, its levels, where it
// stands, what it answers on, what the saved scene holds for it, and the
// palettes — with no tab row to hide half of it behind.
test("the plate shows the selected fixture's sections at once, with no tab row", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const plate = page.getByTestId("lighting-plate");
  await expect(plate).toBeVisible();
  await expect(plate.getByRole("tab")).toHaveCount(0);

  await expect(plate.getByRole("button", { name: "Identify" })).toBeVisible();
  await expect(plate.getByRole("button", { name: /Turn off|Turn on/ })).toBeVisible();
  await expect(plate.getByLabel("Fixture intensity")).toBeVisible();
  await expect(plate.getByLabel("Fixture CCT")).toBeVisible();
  await expect(plate.getByLabel("Fixture rotation in degrees")).toBeVisible();

  const patchFacts = page.getByTestId("lighting-plate-patch-facts");
  await expect(patchFacts).toContainText("DMX start");
  await expect(patchFacts).toContainText("Universe");

  // What the saved scene holds for this fixture, beside what the rig is doing.
  const sceneValues = page.getByTestId("lighting-plate-scene-values");
  await expect(sceneValues).toContainText("In scene Warm wash");
  await expect(sceneValues).toContainText("Saved intensity");
  await expect(sceneValues).toContainText("On the rig now");

  await expect(page.getByTestId("lighting-plate-palettes")).toBeAttached();
  await expect(plate.getByRole("button", { name: "Delete fixture" })).toBeVisible();
});

test("renders scaled studio preview inside the current MacBook-sized viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  const response = await page.goto("/?fixture=lighting-populated&transport=fixture&operatorReview=studio");
  expect(response, "studio preview fixture should return a document response").not.toBeNull();
  expect(response!.status(), "studio preview fixture should not fail to load").toBeLessThan(400);

  const root = page.locator("[data-operator-layout-root]");
  await expect(root).toHaveAttribute("data-review-surface", "studioPreview");
  await expect(root).toHaveAttribute("data-layout-mode", "studioFull");
  await expect(root).toHaveAttribute("data-layout-width", "2560");
  await expect(root).toHaveAttribute("data-layout-height", "1440");
  await expect(page.getByText(/Studio Preview/)).toBeVisible();
  await expectToolbarPrimaryControlsFit(page);
  await expectNoDocumentScroll(page);

  const visualBounds = await root.boundingBox();
  expect(visualBounds?.width ?? 0).toBeLessThanOrEqual(1512 + 1);
  expect(visualBounds?.height ?? 0).toBeLessThanOrEqual(982 + 1);
  expect((visualBounds?.width ?? 0) / (visualBounds?.height ?? 1)).toBeCloseTo(16 / 9, 2);
});

test("enters and exits scaled studio preview from the command palette", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await openFixture(page, "lighting-populated");

  await page.keyboard.press("Meta+K");
  await page.locator("input[placeholder*=command]").fill("studio preview");
  await expect(page.getByRole("option", { name: "Enter Studio Preview at 2560 × 1440" })).toBeVisible();
  await page.getByRole("option", { name: "Enter Studio Preview at 2560 × 1440" }).click();

  const root = page.locator("[data-operator-layout-root]");
  await expect(root).toHaveAttribute("data-review-surface", "studioPreview");
  await expect(root).toHaveAttribute("data-layout-mode", "studioFull");
  await expect(page.getByText(/Studio Preview — 2560 × 1440 at/)).toBeVisible();

  await page.keyboard.press("Meta+K");
  await page.locator("input[placeholder*=command]").fill("studio preview");
  await expect(page.getByRole("option", { name: "Exit Studio Preview" })).toBeVisible();
  await page.getByRole("option", { name: "Exit Studio Preview" }).click();

  await expect(root).toHaveAttribute("data-review-surface", "native");
});

test("supports lighting preview mode without driving live scene state", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: /Preview/ }).click();
  // Visual overhaul A, Slice 5. Old: a preview banner across the canvas. New:
  // the state display says PREVIEW and offers Save to the rig / Discard.
  // Reason: a state is a state display, in the same place every time.
  await expect(page.getByTestId("lighting-state-display")).toContainText("PREVIEW");
  await expect(page.getByText("Editing offline")).toBeVisible();
  await expect(page.getByRole("button", { name: /Patch/ })).toBeDisabled();
  await expect(page.getByText("Preview values")).toBeVisible();

  await page.getByLabel("Fixture intensity").focus();
  await page.getByLabel("Fixture intensity").press("End");
  // Visual overhaul A, Slice 5. Old: the health bar's "Offline edits" cell.
  // New: the footer's Preview item says "offline edits", and the state display
  // says PREVIEW above it.
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("offline edits");
  await expect(page.getByRole("button", { name: /^Fixture Key, 100 percent,/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Visual overhaul A, Slice 5. Old: the preview banner carried an Exit key.
  // New: the cluster's Preview key is the way in and the way out. Reason: the
  // banner is gone — the state display says PREVIEW and offers Save / Discard,
  // and the toggle that entered preview leaves it.
  await page.getByTestId("lighting-preview-toggle").click();
  await expect(page.getByRole("dialog", { name: "Exit preview with offline edits?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByText("Scene loaded into preview.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Interview (preview)" })).toBeVisible();

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("lighting-state-display")).not.toContainText("PREVIEW");
  await expect(page.getByRole("button", { name: /^Fixture Key, 76 percent,/ })).toHaveAttribute("aria-pressed", "true");
});

test("supports lighting palette pools from the inspector and quick picker", async ({ page }) => {
  await openFixture(page, "lighting-palettes-selected");

  // Visual overhaul A, Slice 5b. Old: the Palettes tab was selected and the
  // panel was scoped by the plate's label. New: the palettes are a section of
  // the plate, under whatever is selected. Reason: they are a tool for the
  // selection, not a place to go.
  const inspector = page.getByTestId("lighting-plate-palettes");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Intensity" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "CCT" })).toBeVisible();
  await expect(inspector.getByText("1 selected")).toBeVisible();

  await inspector.getByRole("button", { name: "Apply Low" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Lighting intensity palette 'Low' applied to 1 fixture/)).toBeVisible();

  await page.keyboard.press(modifierShortcut("Shift+KeyP"));
  const quickPicker = page.getByRole("dialog", { name: "Lighting palettes" });
  await expect(quickPicker).toBeVisible();
  await expect(quickPicker.getByLabel("Search palettes")).toBeFocused();
  await expect(quickPicker.getByRole("button", { name: "Apply palette Low 10 %" }).first()).toBeVisible();
  await quickPicker.getByLabel("Search palettes").fill("studio");
  await quickPicker.getByRole("button", { name: "Apply palette Studio 4000 K" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent, 4000 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  await inspector.getByRole("button", { name: "Create Intensity palette" }).click();
  await inspector.getByLabel("Palette name").fill("Desk");
  await inspector.getByLabel("Palette value").fill("33");
  await inspector.getByRole("button", { name: "Save" }).click();
  await expect(inspector.getByRole("button", { name: "Apply Desk" })).toBeVisible();

  await openFixture(page, "lighting-palettes-empty");
  const emptyInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(emptyInspector.getByText("0 selected")).toBeVisible();
  await expect(emptyInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();
  await page.keyboard.press(modifierShortcut("Shift+KeyP"));
  await expect(page.getByText("Select fixtures to apply.")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Lighting palettes" }).getByRole("button", { name: "Apply palette Low 10 %" })
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await openFixture(page, "lighting-palettes-patch-disabled");
  const patchInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(patchInspector.getByText("1 selected")).toBeVisible();
  await expect(patchInspector.getByText("Patch locked")).toBeVisible();
  await expect(patchInspector.getByRole("button", { name: "Create Intensity palette" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Edit Low" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Move Low later" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Delete Low" })).toBeDisabled();
});

test("supports lighting toolbar search, patch mode, and empty-state fixture create", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();
  await page.getByRole("button", { name: "Recall scene Warm wash" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (active)" })).toBeVisible();
  await page.keyboard.press(modifierShortcut("KeyF"));
  await expect(page.getByLabel("Search fixtures, scenes and groups")).toBeFocused();
  const recentScenes = page.getByRole("listbox", { name: "Recent scenes" });
  await expect(recentScenes).toBeVisible();
  await expect(recentScenes.getByRole("option", { name: /Warm wash/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes.getByRole("option", { name: /Interview/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Recall scene Interview (active)" })).toBeVisible();

  await page.getByRole("button", { name: "Recall scene Interview (active)" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete scene/ }).click();
  await page.getByRole("button", { name: "Delete scene" }).click();
  await expect(page.getByText("Scene 'Interview' deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toBeVisible();

  await page.getByLabel("Search fixtures, scenes and groups").fill("zzz");
  await expect(page.getByTestId("lighting-cluster").getByText(/No scenes match .zzz./)).toBeVisible();
  await expect(page.getByTestId("lighting-cluster").getByText(/No groups match .zzz./)).toBeVisible();
  await page.getByLabel("Search fixtures, scenes and groups").fill("");
  await expect(page.getByTestId("lighting-cluster").getByText(/No scenes match .zzz./)).toBeHidden();

  await page.getByRole("button", { name: /Patch/ }).click();
  // Visual overhaul A, Slice 5. Old: the master card's eyebrow read
  // "Master · paused · patch mode". New: patch mode outlines the rig's keys and
  // says why on each of them, and the scenes section says it is paused. Reason:
  // a locked control says why it is locked, rather than a card saying it once.
  await expect(page.getByTestId("lighting-cluster").getByText("paused while patching")).toBeVisible();
  await expect(page.getByTestId("lighting-power-toggle")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Fixture patch start channel")).toBeVisible();
  await expect(page.getByTestId("lighting-beam-fixture-key")).toHaveCount(0);
  await page.getByLabel("Fixture patch start channel").fill("3");
  // The palettes' own "Apply <name>" keys share the plate with the patch
  // panel's Apply, so the patch one is matched exactly.
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("003", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Identify" }).click();
  await expect(page.getByRole("button", { name: /Bursting/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Beam angle in degrees").fill("42");
  await page.getByLabel("Beam angle in degrees").press("Enter");
  await expect(page.getByLabel("Beam angle in degrees")).toHaveValue("42");

  await openFixture(page, "lighting-empty");
  const emptyWorkspace = page.getByRole("main").first();
  await expect(emptyWorkspace.getByText("No fixtures on the rig yet")).toBeVisible();
  await page.getByRole("button", { name: "Add fixture" }).first().click();
  const addFixtureDialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(addFixtureDialog.getByLabel("Name")).toHaveValue("Fixture 1");
  await addFixtureDialog.getByRole("button", { name: "Add fixture" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Fixture 1,/ })).toBeVisible();
});

test("surfaces patch collisions and auto-fixes them in lighting patch mode", async ({ page }) => {
  await openFixture(page, "lighting-patch-overlap");

  const workspace = page.getByRole("main").first();
  await page.getByRole("button", { name: /Patch/ }).click();

  const backFixture = page.getByRole("button", { name: /^Fixture Back,/ });
  await backFixture.focus();
  await page.keyboard.press("Enter");
  const patchInspector = page.getByLabel("Lighting inspector — Patch");
  await expect(patchInspector.getByText("Patch collision")).toBeVisible();
  await expect(patchInspector.getByText("Key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto-fix to 003" })).toBeVisible();

  await page.getByRole("button", { name: "Auto-fix to 003" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Back,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("003", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Patch collision")).toHaveCount(0);
});

test("persists lighting view bookmark slots through workspace changes", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.keyboard.press(modifierShortcut("Shift+Digit1"));
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
  await expect(page.getByText("Saved view 1.")).toBeVisible();

  await page.keyboard.press(modifierShortcut("Digit4"));
  await expect(page.getByTestId("planning-workspace")).toBeVisible();
  await page.keyboard.press(modifierShortcut("Digit2"));

  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
  await page.keyboard.press("Shift+Digit1");
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();
});

test("supports lighting drag-lasso multi-select and group save", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: /^Fixture Fill,/ }).focus();
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");

  await expect(page.getByLabel("Selected fixtures", { exact: true }).getByText("2 fixtures selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear the selection" })).toBeVisible();

  await page.getByRole("button", { name: "Create a new lighting group" }).click();
  const createGroupDialog = page.getByRole("dialog", { name: "New lighting group" });
  await expect(createGroupDialog.getByLabel("Group name")).toBeFocused();
  await createGroupDialog.getByLabel("Group name").fill("Group 3");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Group 3, 0 fixtures, off\. Toggle on\.$/i })).toBeVisible();
});

test("saves the current lighting selection as a scene from the inspector prompt", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press(modifierShortcut("Shift+KeyS"));
  const saveSceneDialog = page.getByRole("dialog", { name: "Save as new scene" });
  await expect(saveSceneDialog.getByLabel("Scene name")).toBeFocused();
  await saveSceneDialog.getByLabel("Scene name").fill("Interview reset");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: /Recall scene Interview reset/i })).toBeVisible();
});

test("nudges the selected fixture horizontally from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.24");
  await page.keyboard.press("ArrowRight");

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.35");
});

test("nudges a fixture Position field from the ScrubLabel slider keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  // CONTROLS-06: the Position label is now a role=slider, keyboard-operable like
  // every other slider in the product.
  const stageX = page.getByRole("slider", { name: "Stage X" });
  await expect(stageX).toHaveAttribute("aria-valuenow", "0.24");

  await stageX.focus();
  // The ScrubLabel handles the arrow (and preventDefaults it), so the global
  // stage-plot nudge is suppressed and the value snaps onto the field's grid.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.3");
  await expect(stageX).toHaveAttribute("aria-valuenow", "0.3");

  await page.keyboard.press("Home");
  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("0.0");
  await expect(stageX).toHaveAttribute("aria-valuenow", "0");
});

test("opens typed numeric entry on a lighting intensity slider via Enter and commits", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  // CONTROLS-02: Enter (and bare double-click) on a ScrubSlider opens the shared
  // number dialog; confirming commits the typed value.
  const intensity = page.getByRole("slider", { name: "Fixture intensity" });
  await intensity.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /Set Fixture intensity/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton").fill("42");
  await dialog.getByRole("button", { name: "Set" }).click();

  await expect(dialog).toBeHidden();
  await expect(intensity).toHaveAttribute("aria-valuenow", "42");
});

test("opens lighting intensity typed entry via a bare double-click", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const intensity = page.getByRole("slider", { name: "Fixture intensity" });
  // Bare double-click now opens typed entry (reset relocated to Alt+double-click).
  await intensity.dblclick();
  await expect(page.getByRole("dialog", { name: /Set Fixture intensity/i })).toBeVisible();
});

test("opens typed numeric entry on the lighting grand master and commits", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  // Visual overhaul A, Slice 5: the grand master is the design system's slider,
  // which asks its host for typed entry on a double press or on Enter (old: the
  // scrub slider's own double-click).
  const master = page.getByRole("slider", { name: "Grand master intensity" });
  await master.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Set Grand master" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton").fill("60");
  await dialog.getByRole("button", { name: "Set" }).click();

  await expect(dialog).toBeHidden();
  // The design system's slider reports 0..100 per cent of its travel, which for
  // the grand master is the value itself.
  await expect(master).toHaveAttribute("aria-valuenow", "60");
});

test("drags the selected fixture to a new plot position", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  // Slice 9e: studioFull now rests on the content frame (fitContent). This test's
  // fixed pixel-delta drag assumes the un-zoomed Fill screen plot, so select it and
  // wait for the inner transform to settle to identity before driving the pointer.
  await page.getByRole("button", { name: "Fill screen", exact: true }).click();
  await expect(page.locator('[data-inner-content="true"]')).toHaveAttribute("transform", "translate(0 0) scale(1)");

  const fixture = page.getByRole("button", { name: /^Fixture Key,/ });
  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  await fixture.scrollIntoViewIfNeeded();
  const start = await fixture.evaluate((node) => {
    const marker = node.querySelector("g[filter]");
    if (!(marker instanceof SVGGraphicsElement)) throw new Error("Fixture marker body not found");
    const matrix = marker.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");

    return { x: matrix.e, y: matrix.f };
  });
  const startOutputTransform = await output.getAttribute("transform");

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 120, { steps: 8 });
  await expect.poll(async () => output.getAttribute("transform")).not.toBe(startOutputTransform);
  await page.mouse.up();
  expect(await output.getAttribute("transform")).not.toBe(startOutputTransform);

  await expect(page.getByLabel("Stage X position in metres")).toHaveValue("1.5");
  await expect(page.getByLabel("Stage Y position in metres")).toHaveValue("1.0");
});

test("mirrors fixture intensity slider drafts on the stage plot before commit", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const fixture = page.getByRole("button", { name: /^Fixture Key,/ });
  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  await expect(fixture).toHaveAttribute("aria-label", /76 percent/);
  const startOutputOpacity = await output.locator("stop").first().getAttribute("stop-opacity");

  const slider = page.getByRole("slider", { name: "Fixture intensity" });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;

  await page.mouse.move(box!.x + box!.width * 0.76, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.24, y, { steps: 8 });

  await expect.poll(async () => fixture.getAttribute("aria-label")).toMatch(/2[0-9] percent/);
  await expect
    .poll(async () => output.locator("stop").first().getAttribute("stop-opacity"))
    .not.toBe(startOutputOpacity);
  await page.mouse.up();

  await expect(fixture).toHaveAttribute("aria-label", /2[0-9] percent/);
});

test("rotates the selected fixture from the plot and inspector", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  // Slice 9e: studioFull now rests on the content frame (fitContent), whose uniform
  // "meet" scaling changes the screen->plot angle vs. Fill screen's non-uniform stretch.
  // This test's pixel-based rotate-handle drag assumes Fill screen, so select it first.
  await page.getByRole("button", { name: "Fill screen", exact: true }).click();
  await expect(page.locator('[data-inner-content="true"]')).toHaveAttribute("transform", "translate(0 0) scale(1)");

  const rotationInput = page.getByLabel("Fixture rotation in degrees");
  await expect(rotationInput).toHaveValue("0");

  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  const startOutputTransform = await output.getAttribute("transform");
  const handle = page.locator('[data-fixture-rotate-handle="fixture-key"]');
  await expect(handle).toBeVisible();
  const points = await handle.evaluate((node) => {
    const circle = node.querySelector("circle");
    const marker = node.closest("[data-fixture-id]");
    const body = marker?.querySelector("g[filter]");
    if (!(circle instanceof SVGCircleElement) || !(body instanceof SVGGraphicsElement)) {
      throw new Error("Fixture rotate handle geometry not found");
    }
    const circleRect = circle.getBoundingClientRect();
    const matrix = body.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");
    return {
      centerX: matrix.e,
      centerY: matrix.f,
      handleX: circleRect.left + circleRect.width / 2,
      handleY: circleRect.top + circleRect.height / 2,
    };
  });

  await page.mouse.move(points.handleX, points.handleY);
  await page.mouse.down();
  await page.mouse.move(points.centerX + 96, points.centerY - 12, { steps: 8 });
  await expect.poll(async () => output.getAttribute("transform")).not.toBe(startOutputTransform);
  await page.mouse.up();
  expect(await output.getAttribute("transform")).not.toBe(startOutputTransform);
  // Visual overhaul A, Slice 5. Old: the drag landed on exactly 82°. New: it
  // lands between 80° and 85°. Reason: the rail left the body, so the plot is
  // wider and the same pixel offset maps to a slightly different angle; what
  // the test is for — dragging the handle right and a little up rotates the
  // fixture to about a right angle — is unchanged.
  const draggedRotation = Number(await rotationInput.inputValue());
  expect(draggedRotation, "the rotate handle drag lands near 82°").toBeGreaterThanOrEqual(80);
  expect(draggedRotation, "the rotate handle drag lands near 82°").toBeLessThanOrEqual(85);

  await rotationInput.fill("270");
  await rotationInput.press("Enter");
  await expect(rotationInput).toHaveValue("270");
  await expect(page.locator('[data-fixture-id="fixture-key"] g[filter]').first()).toHaveAttribute(
    "transform",
    /rotate\(270\)/
  );
});

test("toggles the expanded DMX monitor from the keyboard", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.keyboard.press(modifierShortcut("Shift+KeyM"));
  const dmxMonitorDialog = page.getByRole("dialog", { name: "DMX universe U1" });
  await expect(dmxMonitorDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dmxMonitorDialog).toBeHidden();
});

test("opens the compact DMX strip and expands it to the full monitor", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Show DMX strip" }).click();
  await expect(page.getByRole("region", { name: "Universe 1 compact DMX strip" })).toBeVisible();
  await page.getByRole("button", { name: "Open full DMX monitor" }).click();
  const dialog = page.getByRole("dialog", { name: "DMX universe U1" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Patched to a fixture")).toBeVisible();
  await expect(dialog.getByRole("grid", { name: "DMX universe U1 channels" })).toBeVisible();
  const keyDimmer = dialog.locator('[title="Ch 1 · Key · Dimmer"]');
  await expect(keyDimmer).toBeVisible();
  // 2026-09 audit remediation, Slice 12: DMX values read as decimal 0–255
  // (they used to be two-digit hex). Key's dimmer resolves to 194 here (≈76 % of 255).
  await expect(keyDimmer.getByTestId("dmx-cell-value")).toHaveText("194");
  await expect(dialog.getByTestId("dmx-cell-value").filter({ hasText: /[A-F]/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("shows lighting DMX-unreachable posture and blackout hold", async ({ page }) => {
  await openFixture(page, "lighting-dmx-unreachable");

  // Visual overhaul A, Slice 5. Old: a "DMX bridge unreachable" banner across
  // the canvas with its sentence. New: the state display says UNREACHABLE, says
  // why in the operator's words, and offers the way out. Reason: a state is a
  // state display, in the same place every time.
  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("UNREACHABLE");
  await expect(stateDisplay).toContainText(/is not answering, so nothing you press will reach the rig/i);
  await expect(page.getByTestId("lighting-state-setup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Identify" })).toBeDisabled();

  await openFixture(page, "lighting-populated");
  // Visual overhaul A, Slice 5. Old: the key was named "Emergency cut all
  // fixtures". New: "Cut all fixtures to 0 %". Reason: the cluster's danger key
  // says what it does in the operator's words; "emergency" is not one of them.
  await page.getByRole("button", { name: "Cut all fixtures to 0 %" }).click();
  const cutAllDialog = page.getByRole("dialog", { name: "Cut all fixtures?" });
  await expect(cutAllDialog).toBeVisible();
  await cutAllDialog.getByRole("button", { name: "Cut all", exact: true }).click();
  // Visual overhaul A, Slice 5. Old: the master card printed "All fixtures off"
  // and "Master · 0 / 4 on". New: the cluster's Lighting key says it is off and
  // nothing is lit, and the state display's meta line carries the count.
  // Reason: the master card is the cluster's key and hero now.
  await expect(page.getByTestId("lighting-power-toggle")).toContainText("nothing lit");
  await expect(page.getByTestId("lighting-state-display")).toContainText("0 of 4 fixtures on");
  await expect(page.getByRole("button", { name: /^Fixture Key, off,/ })).toHaveAttribute("aria-pressed", "true");
});

test("frames the populated rig via the stage-plot Frame mode (DENSITY-04)", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expect(page.getByTestId("lighting-stage")).toBeVisible();

  const inner = page.locator('[data-inner-content="true"]');
  const frame = page.getByRole("button", { name: "Frame", exact: true });
  const fitRoom = page.getByRole("button", { name: "Fit room", exact: true });
  const IDENTITY = "translate(0 0) scale(1)";

  // studioFull (2560x1440) now rests on the content frame by default — the rig is
  // zoomed/panned to fill the canvas, so the inner transform is non-identity.
  await expect(frame).toHaveAttribute("aria-pressed", "true");
  await expect(inner).not.toHaveAttribute("transform", IDENTITY);

  // Selecting another mode clears the frame and returns to the identity transform.
  await fitRoom.click();
  await expect(fitRoom).toHaveAttribute("aria-pressed", "true");
  await expect(frame).toHaveAttribute("aria-pressed", "false");
  await expect(inner).toHaveAttribute("transform", IDENTITY);

  // Re-selecting Frame re-applies the content fit.
  await frame.click();
  await expect(frame).toHaveAttribute("aria-pressed", "true");
  await expect(inner).not.toHaveAttribute("transform", IDENTITY);
});

// R2-B (round-2 audit, R2-MOT-03): the chip-hover marker pulse is decorative
// (a passive hover echo) — under prefers-reduced-motion the static ring alone
// must carry the chip ↔ marker pairing, with no SVG <animate> running. The
// identify burst stays animated by documented design (user-initiated gesture).
test("chip-hover marker pulse is gated by prefers-reduced-motion", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const stage = page.getByTestId("lighting-stage");
  const chip = page
    .getByRole("list", { name: /selected fixture/ })
    .getByRole("listitem")
    .first();
  await expect(chip).toBeVisible();

  // Default motion: hovering the chip pulses the marker ring via <animate>.
  await chip.hover();
  await expect(stage.locator("animate").first()).toBeAttached();

  // Reduced motion: the ring renders static — zero <animate> elements.
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chip.hover();
  await expect(stage.locator("circle[stroke-width='1.6']").first()).toBeAttached();
  await expect(stage.locator("animate")).toHaveCount(0);
});
