import { expect, test, type Locator } from "@playwright/test";

import { ARM_DWELL_MS } from "../../packages/design-system/src/components/useArm";
import { expectNoDocumentScroll } from "./helpers/geometry";
import {
  expectLightingColumnsFit,
  expectToolbarPrimaryControlsFit,
  openLightingPageMenu,
  openPlateMenu,
  openPlotMenu,
  openSceneMenu,
  pressTwice,
} from "./helpers/lighting";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";
import { pausePageClock } from "./helpers/pageClock";

// plan PR 4 / workstream D4: lighting workspace specs split out of
// operator-shell.spec.ts. Covers the snapshot loading posture, fixture
// snapshot rendering, the layout at 2560×1440, preview mode, palette pools,
// patch mode, view bookmarks, drag-lasso multi-select, fixture drag/rotate,
// typed entry, DMX monitor expand, and DMX-unreachable + blackout posture. New
// pages program, Slice 3 (D6): Lighting binds no key of its own, so every case
// here reaches its control on screen; the keys it used to press are pressed
// in `no-shortcuts.spec.ts`, where nothing may answer them. Slice SW (D22): the
// cases for other sizes and for Studio Preview went; the layout's checks are
// the 2560 case's. The visual overhaul's Lighting page (2026-10-04): the
// standing keys are the page ⋯'s items (their test ids kept); the scenes are
// rows with the Save row under them, the one way to save a new scene; the plot
// has a bar under it (the selection, Highlight, Solo, Find, the zoom, the views)
// and a menu (framing, render mode, symbol key, Save and Clear of the views);
// every "Delete …" arms in place in its object's menu; the plot draws the room
// at its real metres and never changes height.

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
  // The visual overhaul (2026-10-04): the bridge's address is the state
  // display's sentence alone; the footer counts the universe's channels.
  await expect(page.getByTestId("lighting-state-display")).toContainText("192.168.1.80 · universe 1");
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("Universe 1");
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("12 / 512 channels");
  // The scene on the rig says so in the deck's RECALL word.
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (on rig)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(page.getByTestId("lighting-scene-word-scene-warm-wash")).toHaveText("on rig");
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
  // New pages program, Slice 3 (D6): the footer prints no key hints. The
  // visual overhaul: the DMX strip's key is the page ⋯'s "DMX strip".
  await expect(page.getByTestId("lighting-footer-shortcuts")).toHaveCount(0);
  await expect(page.getByTestId("lighting-health-bar").locator("kbd")).toHaveCount(0);
  await openLightingPageMenu(page);
  await expect(page.getByTestId("lighting-dmx-strip-toggle")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (on rig)" })).toHaveAttribute(
    "data-selected",
    "true"
  );
  // The plate shows the fixture still; the scene's name is its row's, not the
  // plot's (the plot's pill went with the overhaul).
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
  await expect(page.getByLabel("Lighting inspector — Fixture").getByTestId("lighting-plate-head")).toContainText(
    "Apollo Bridge"
  );
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Warm wash, off,/ })).toHaveAttribute("aria-pressed", "true");

  // The visual overhaul. Old: the group chip's chevron "Inspect Front group".
  // New: its ⋯'s "Show on the plate", whose title plate then names the group.
  await page.getByTestId("lighting-group-menu-group-front").click();
  await page.getByRole("menuitem", { name: "Show on the plate" }).click();
  await expect(page.getByTestId("lighting-plate-head")).toContainText("Front");
  await expect(page.getByTestId("lighting-plate-head")).toContainText("Group");
  await page.getByRole("button", { name: "Turn group off" }).click();
  await expect(page.getByRole("button", { name: /Front, 2 fixtures.*off\. Toggle on\./i })).toBeVisible();
});

test("renders lighting fixture symbol families and stage plot render modes", async ({ page }) => {
  await openFixture(page, "lighting-symbol-families");

  const plot = page.getByRole("application", { name: "Lighting stage plot" });
  await expect(plot.locator('[data-fixture-id="fixture-key"] [data-symbol-kind="panel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-soft-mat"] [data-symbol-kind="soft-mat"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-back"] [data-symbol-kind="linear-bar"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-fresnel"] [data-symbol-kind="fresnel"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-id="fixture-kicker"] [data-symbol-kind="control-node"]')).toHaveCount(1);
  await expect(plot.locator('[data-fixture-output-id="fixture-kicker"]')).toHaveCount(0);

  // The visual overhaul: the render modes and the symbol key are the plot
  // menu's (its ⋯ in the bar, or a right-click on the floor).
  await (await openPlotMenu(page)).getByRole("menuitemradio", { name: "Coverage" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "coverage");
  await (await openPlotMenu(page)).getByRole("menuitemradio", { name: "Photometric" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "photometric");
  await expect(plot.locator('[data-fixture-output-id="fixture-back"]')).toHaveText(/593 lx @ 1 m|120 deg est\./);
  await (await openPlotMenu(page)).getByRole("menuitemradio", { name: "Pixel" }).click();
  await expect(plot).toHaveAttribute("data-render-mode", "pixel");
  expect(await plot.locator('[data-fixture-id="fixture-back"] [data-emitter-segment="true"]').count()).toBeGreaterThan(
    0
  );

  const symbolKey = page.getByTestId("fixture-symbol-key");
  await expect(symbolKey).toHaveCount(0);
  await (await openPlotMenu(page)).getByRole("menuitemcheckbox", { name: /Symbol key/ }).click();
  await expect(symbolKey).toBeVisible();
  await expect(page.getByTestId("fixture-symbol-key-row-litepanels-astra-bicolor")).toContainText("2");
  await expect(page.getByTestId("fixture-symbol-key-row-aputure-infinibar-pb12")).toContainText("8 ch");

  const fresnel = page.getByRole("button", { name: /^Fixture Fresnel,/ });
  await fresnel.focus();
  await page.keyboard.press("Enter");
  await expect(fresnel).toHaveAttribute("aria-pressed", "true");
});

// New pages program, Slice SW (D22). Old: "keeps the full lighting workspace
// visible at the 1920x1080 fallback size" and "adapts lighting layout modes
// across supported logical viewport sizes", six sizes from 1280 × 800 up, the
// narrow drawer among them. New: that loop's 2560 row, with the fallback case's
// look at what the cluster carries. Reason: one screen, one layout.
test("the lighting layout at 2560x1440: the cluster, the stage and every primary control fit", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openFixture(page, "lighting-populated");

  // Visual overhaul A, Slice 5: the shell's cluster carries what the toolbar
  // carried and the rig's state above it; the scenes and the groups are its
  // sections, so they are read off the cluster rather than the workspace's own
  // main element.
  const cluster = page.getByTestId("lighting-cluster");
  await expect(cluster).toBeVisible();
  await expect(cluster.getByText("Scenes", { exact: true })).toBeVisible();
  await expect(cluster.getByText("Groups", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  await expect(page.getByRole("application", { name: "Lighting stage plot" })).toBeVisible();
  await expect(page.getByTestId("lighting-page-menu")).toBeVisible();
  await expect(page.getByTestId("lighting-plot-bar").getByText("1 fixture selected")).toBeVisible();
  await expectToolbarPrimaryControlsFit(page);
  await expectNoDocumentScroll(page);
  await expectLightingColumnsFit(page);

  const stageBounds = await page.getByTestId("lighting-stage").boundingBox();
  expect(stageBounds?.width ?? 0).toBeGreaterThanOrEqual(560);
  expect(stageBounds?.height ?? 0).toBeGreaterThanOrEqual(440);

  // The visual overhaul: Highlight, Solo and Find are take-time keys in the
  // bar under the plot, and the plot keeps its height whatever is selected.
  for (const testId of ["lighting-highlight-toggle", "lighting-solo-toggle", "lighting-identify-find"]) {
    await expect(page.getByTestId("lighting-plot-bar").getByTestId(testId)).toBeVisible();
    await expect(page.getByTestId(testId)).toHaveAttribute("data-take", "");
  }
  const before = stageBounds?.height ?? 0;
  await page.getByRole("button", { name: "Clear the selection" }).click();
  await expect(page.getByTestId("lighting-plot-bar")).toContainText("Nothing selected");
  expect((await page.getByTestId("lighting-stage").boundingBox())?.height).toBe(before);
});

// The visual overhaul (2026-10-04): the plot is the room at its real metres.
// The rulers read in metres, and every name is 13 px whatever the zoom.
test("the plot draws the room at its real metres, with rulers and names at one size", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const plot = page.getByRole("application", { name: "Lighting stage plot" });
  await expect(plot.locator('svg[data-axis="x"] text').first()).toHaveText("0");
  await expect(plot.locator('svg[data-axis="y"] text').first()).toHaveText("0");
  const labels = page.getByTestId("lighting-plot-labels");
  await expect(labels.locator('[data-label-for="fixture-key"]')).toContainText("Key");
  const sizes = await labels
    .locator("text")
    .evaluateAll((nodes) => [...new Set(nodes.map((node) => getComputedStyle(node).fontSize))]);
  expect(sizes).toEqual(["13px"]);
  const zoomed = await (async () => {
    await page.getByRole("button", { name: "Zoom in" }).click();
    return labels
      .locator("text")
      .evaluateAll((nodes) => [...new Set(nodes.map((node) => getComputedStyle(node).fontSize))]);
  })();
  expect(zoomed).toEqual(["13px"]);
});

// Visual overhaul A, Slice 5 (plan Slice 5, findings M3 and C3): while the
// bridge has not passed its probe, the rig's keys are outlined and say why, and
// the plot says so on its face. The visual overhaul (2026-10-04): the sentence
// says what is so (a recall is refused; until then it said nothing would reach
// the rig), and CUT ALL stays live: the hardware link takes it in every state.
test("unreachable: the state display carries the bridge sentence, the rig is outlined and the header lamp is red", async ({
  page,
}) => {
  await openFixture(page, "lighting-dmx-unreachable");

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("UNREACHABLE");
  await expect(stateDisplay).toHaveAttribute("data-tone", "error");
  await expect(stateDisplay).toContainText(/has not passed its probe, so recalls are refused/);
  await expect(page.getByTestId("lighting-state-setup")).toBeVisible();
  await expect(page.getByTestId("lighting-emergency-cut")).not.toHaveAttribute("aria-disabled", "true");

  for (const testId of ["lighting-power-toggle", "lighting-grand-master"]) {
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
  await expect(page.getByTestId("lighting-stage-lock-note")).toHaveText("locked · the bridge has not passed its probe");
});

// Found, to check (2026-09-28): nothing looked at the bridge during a session.
// The hardware link's watch says when it stops answering, and the owner's
// decision (2026-09-29) is to say it and lock nothing: the rig's keys stay
// live, the plot is not locked, and the header lamp is amber.
test("not answering: the watch's word is amber, and nothing is locked", async ({ page }) => {
  await openFixture(page, "lighting-bridge-silent");

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("NOT ANSWERING");
  await expect(stateDisplay).toHaveAttribute("data-tone", "attention");
  await expect(stateDisplay).toContainText(/has not answered since \d\d:\d\d\. Nothing is locked; this clears/);
  // No key to Setup: a probe run mid-session that fails would lock the rig
  // (the review of #260).
  await expect(page.getByTestId("lighting-state-setup")).toHaveCount(0);

  // The header's word is the Lighting tab's, read from another page
  // (shell.spec.ts).

  for (const testId of ["lighting-power-toggle", "lighting-emergency-cut", "lighting-grand-master"]) {
    await expect(page.getByTestId(testId), `${testId} stays live`).not.toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByTestId("lighting-stage")).not.toHaveAttribute("data-locked", "");
  await expect(page.getByTestId("lighting-stage-lock-note")).toHaveCount(0);
});

// The review of #260: a silent bridge outranks a hold, so its sentence names
// the hold, and `Open Setup` is the way to the switch, as it is for HELD.
test("not answering while held: the sentence names the hold, and Open Setup goes to the switch", async ({ page }) => {
  await openFixture(page, "lighting-bridge-silent-held");

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("NOT ANSWERING");
  await expect(stateDisplay).toContainText(/and the outputs are held until armed in Setup \/ Support/);
  await expect(page.getByTestId("lighting-state-setup")).toBeVisible();
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
  await expect(stateDisplay).toContainText(/no longer matches Warm wash/i);
  await expect(page.getByTestId("lighting-state-save")).toBeVisible();
  await expect(page.getByTestId("lighting-state-revert")).toBeVisible();
  await expect(page.getByTestId("lighting-footer-telemetry")).toContainText("unsaved");
  // The scene's row says it in the deck's word, and the plate's saved tick
  // under the fixture's level turns Yellow where the rig left it.
  await expect(page.getByTestId("lighting-scene-word-scene-warm-wash")).toHaveText("unsaved");
});

// The visual overhaul (2026-10-04, the ROADMAP's follow-up): whether the rig
// has left its scene is the hardware link's word, decided without the
// highlight, solo and identify overlays. Until then the page compared the
// overlaid fixtures itself, and a Highlight read UNSAVED.
test("a Highlight changes nothing saved: the scene stays on the rig", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await page.getByTestId("lighting-highlight-toggle").click();
  await expect(page.getByTestId("lighting-highlight-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lighting-latch-highlight")).toContainText("Key");
  await expect(page.getByTestId("lighting-state-display")).not.toContainText("UNSAVED");
  await expect(page.getByTestId("lighting-scene-word-scene-warm-wash")).toHaveText("on rig");
  await page.getByTestId("lighting-latch-highlight-off").click();
  await expect(page.getByTestId("lighting-highlight-toggle")).toHaveAttribute("aria-pressed", "false");
});

// Visual overhaul A, Slice 5: editing offline is a state, not a banner — the
// plot carries the blue keyline and the display offers the two ways out.
test("preview: the plot carries the blue keyline and the state display offers save or discard", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await openLightingPageMenu(page);
  await page.getByTestId("lighting-preview-toggle").click();

  const stateDisplay = page.getByTestId("lighting-state-display");
  await expect(stateDisplay).toContainText("PREVIEW");
  await expect(stateDisplay).toHaveAttribute("data-tone", "info");
  // Found, to check (2026-09-28): the key read `Save to the rig`, and it saves
  // into the scene: the rig takes the edits when the scene is recalled.
  await expect(page.getByTestId("lighting-state-preview-save")).toHaveText("Save into the scene");
  await expect(page.getByTestId("lighting-state-preview-discard")).toBeVisible();
  await expect(page.getByTestId("lighting-stage")).toHaveAttribute("data-preview", "");
  // The grand master acts on the rig itself, so it waits while editing offline.
  await expect(page.getByTestId("lighting-grand-master")).toHaveAttribute("aria-disabled", "true");
});

// Found, to check (2026-09-28): `Save · press twice` saved at the first press.
// It arms now, and saves the new scene at the second. The visual overhaul
// (2026-10-04): it is the Save row under the scenes, the one way to save a new
// scene (the "New scene" tile and the plate's Save as new, which saved at one
// press or after a name, went).
test("the Save row arms at the first press and saves at the second", async ({ page }) => {
  await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);

  const save = page.getByTestId("lighting-save-scene");
  await save.click();
  await expect(save).toHaveAttribute("data-armed", "true");
  await expect(page.getByTestId("lighting-state-display")).toContainText("Save as a new scene · press again");
  await expect(page.getByRole("button", { name: "Recall scene Scene 3" })).toHaveCount(0);

  await page.clock.fastForward(ARM_DWELL_MS + 50);
  await save.click();
  await page.clock.resume();
  await expect(page.getByRole("button", { name: "Recall scene Scene 3" })).toBeVisible();
  await expect(save).toHaveAttribute("data-armed", "false");
  await expect(page.getByRole("button", { name: "Save current state as a new scene" })).toHaveCount(0);
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
  await expect(page.getByTestId("lighting-plate-placement")).toContainText("0.24 m");

  const patchFacts = page.getByTestId("lighting-plate-patch-facts");
  await expect(patchFacts).toContainText("DMX start");
  await expect(patchFacts).toContainText("Universe");

  // The visual overhaul: what the scene on the rig holds for this fixture is a
  // ▲ under each slider, the levels' head naming the scene.
  const levels = page.getByTestId("lighting-plate-scene-values");
  await expect(levels).toContainText("saved in Warm wash");
  await expect(page.getByTestId("lighting-saved-intensity")).toBeAttached();
  await expect(page.getByTestId("lighting-saved-cct")).toBeAttached();

  await expect(page.getByTestId("lighting-plate-palettes")).toBeAttached();
  // Delete fixture is the plate title's ⋯, last, and arms in place.
  const menu = await openPlateMenu(page);
  await expect(menu.getByTestId("lighting-plate-menu-delete")).toHaveText("Delete fixture…");
  await expectLightingColumnsFit(page);
});

test("supports lighting preview mode without driving live scene state", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await openLightingPageMenu(page);
  await page.getByTestId("lighting-preview-toggle").click();
  // Visual overhaul A, Slice 5. Old: a preview banner across the canvas. New:
  // the state display says PREVIEW and offers Save into the scene / Discard.
  // Reason: a state is a state display, in the same place every time.
  await expect(page.getByTestId("lighting-state-display")).toContainText("PREVIEW");
  await expect(page.getByText("editing offline", { exact: false }).first()).toBeVisible();
  await openLightingPageMenu(page);
  await expect(page.getByTestId("lighting-patch-toggle")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lighting-plate-preview")).toContainText("Preview values");

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

  // The page ⋯'s Preview is the way in and the way out.
  await openLightingPageMenu(page);
  await page.getByTestId("lighting-preview-toggle").click();
  await expect(page.getByRole("dialog", { name: "Exit preview with offline edits?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByText("Scene loaded into preview.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recall scene Interview (preview)" })).toBeVisible();

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("lighting-state-display")).not.toContainText("PREVIEW");
  await expect(page.getByRole("button", { name: /^Fixture Key, 76 percent,/ })).toHaveAttribute("aria-pressed", "true");
});

test("supports lighting palette pools from the inspector", async ({ page }) => {
  await openFixture(page, "lighting-palettes-selected");

  // Visual overhaul A, Slice 5b. Old: the Palettes tab was selected and the
  // panel was scoped by the plate's label. New: the palettes are a section of
  // the plate, under whatever is selected. Reason: they are a tool for the
  // selection, not a place to go.
  const inspector = page.getByTestId("lighting-plate-palettes");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Intensity" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "CCT" })).toBeVisible();
  await expect(inspector).toContainText("1 selected · live");

  await inspector.getByRole("button", { name: "Apply Low" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Lighting intensity palette 'Low' applied to 1 fixture/)).toBeVisible();

  // New pages program, Slice 3 (decision 7). Old: Ctrl+Shift+P opened the quick
  // palette panel, which applied Studio 4000 K by search. New: the plate's own
  // "Apply Studio". Reason: the panel went with its key; the plate's Palettes
  // section applies the same palettes to the same selection.
  await inspector.getByRole("button", { name: "Apply Studio" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Key, 10 percent, 4000 kelvin/i })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // The visual overhaul: the form opens beside the pool, a popover.
  await inspector.getByRole("button", { name: "Create Intensity palette" }).click();
  const form = page.getByTestId("lighting-palette-form-intensity");
  await form.getByLabel("Palette name").fill("Desk");
  await form.getByLabel("Palette value").fill("33");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(inspector.getByRole("button", { name: "Apply Desk" })).toBeVisible();

  await openFixture(page, "lighting-palettes-empty");
  const emptyInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(emptyInspector).toContainText("0 selected");
  await expect(emptyInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();

  // Patch locks the palettes: the tiles, the ＋ and every item of a tile's ⋯
  // but Delete's arm, which waits too.
  await openFixture(page, "lighting-palettes-patch-disabled");
  const patchInspector = page.getByLabel(/Lighting inspector.*Palettes/);
  await expect(patchInspector).toContainText("1 selected · patch locked");
  await expect(patchInspector.getByRole("button", { name: "Create Intensity palette" })).toBeDisabled();
  await expect(patchInspector.getByRole("button", { name: "Apply Low" })).toBeDisabled();
  await page.getByTestId("lighting-palette-menu-palette-intensity-low").click();
  for (const item of ["edit", "later", "delete"]) {
    await expect(page.getByTestId(`lighting-palette-menu-palette-intensity-low-${item}`)).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  }
});

// The visual overhaul: a palette's Delete… arms in place in its ⋯ (until then
// the browser's own confirm asked).
test("a palette's Delete arms in its menu and deletes at the second press", async ({ page }) => {
  await page.clock.install();
  await openFixture(page, "lighting-palettes-selected");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);
  const tiles = page.getByTestId("lighting-plate-palettes");
  await page.getByTestId("lighting-palette-menu-palette-intensity-low").click();
  await pressTwice(page, page.getByTestId("lighting-palette-menu-palette-intensity-low-delete"));
  await page.clock.resume();
  await expect(tiles.getByRole("button", { name: "Apply Low" })).toHaveCount(0);
});

// Found, to check (2026-09-28): Lighting's Undo forgot its steps when the page
// was left. It keeps them for the session now, and forgets them only at a
// restore or a restart of the hardware link.
test("Undo still reaches a step after the page was left and opened again", async ({ page }) => {
  await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);

  // The visual overhaul: a right-click on the row opens its menu, whose Delete
  // scene… arms in place and deletes at the second press.
  await page.getByRole("button", { name: /^Recall scene Interview/ }).click({ button: "right" });
  await pressTwice(page, page.getByTestId("lighting-scene-menu-scene-interview-delete"));
  await page.clock.resume();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toHaveCount(0);
  await expect(page.getByTestId("lighting-undo")).toHaveAttribute("aria-label", "Undo Delete scene Interview");

  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(page.getByTestId("lighting-undo")).toHaveCount(0);
  await nav.getByRole("button", { name: "Lighting", exact: true }).click();

  const undo = page.getByTestId("lighting-undo");
  await expect(undo).toHaveAttribute("aria-label", "Undo Delete scene Interview");
  await undo.click();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toBeVisible();
});

test("supports lighting toolbar search, patch mode, and empty-state fixture create", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await page.getByRole("button", { name: "Recall scene Interview" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Interview (on rig)" })).toBeVisible();
  await page.getByRole("button", { name: "Recall scene Warm wash" }).click();
  await expect(page.getByRole("button", { name: "Recall scene Warm wash (on rig)" })).toBeVisible();
  // New pages program, Slice 3 (D6). Old: Ctrl+F focused the search field. New:
  // a click on it does. Reason: the keyboard shortcuts are gone; the field is
  // its own way in. Its Recent list still opens on focus and takes the arrows
  // and Enter (decision 11).
  await page.getByLabel("Search fixtures, scenes and groups").click();
  await expect(page.getByLabel("Search fixtures, scenes and groups")).toBeFocused();
  const recentScenes = page.getByRole("listbox", { name: "Recent scenes" });
  await expect(recentScenes).toBeVisible();
  await expect(recentScenes.getByRole("option", { name: /Warm wash/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(recentScenes.getByRole("option", { name: /Interview/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Recall scene Interview (on rig)" })).toBeVisible();

  await openSceneMenu(page, "scene-interview");
  const deleteScene = page.getByTestId("lighting-scene-menu-scene-interview-delete");
  await deleteScene.click();
  await expect(deleteScene).toHaveAttribute("data-armed", "true");
  await expect(page.getByTestId("lighting-state-display")).toContainText("Delete scene Interview · press again");
  await page.waitForTimeout(ARM_DWELL_MS + 50);
  await deleteScene.click();
  await expect(page.getByText("Scene 'Interview' deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toHaveCount(0);
  // New pages program, Slice 3: the message's Undo, matched exactly — the Rig
  // section's Undo key ("Undo Delete scene Interview") now shares the word.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Recall scene Interview/ })).toBeVisible();

  await page.getByLabel("Search fixtures, scenes and groups").fill("zzz");
  await expect(page.getByTestId("lighting-cluster").getByText(/No scenes match .zzz./)).toBeVisible();
  await expect(page.getByTestId("lighting-cluster").getByText(/No groups match .zzz./)).toBeVisible();
  await page.getByLabel("Search fixtures, scenes and groups").fill("");
  await expect(page.getByTestId("lighting-cluster").getByText(/No scenes match .zzz./)).toBeHidden();

  await openLightingPageMenu(page);
  await page.getByTestId("lighting-patch-toggle").click();
  // The visual overhaul: patch mode latches in the latch slot, with Leave, and
  // the scenes section says it is on (until then it said "paused while
  // patching", though the rig's output runs on).
  await expect(page.getByTestId("lighting-latch-patch")).toBeVisible();
  await expect(page.getByTestId("lighting-scenes-section")).toContainText("Patch is on");
  await expect(page.getByTestId("lighting-power-toggle")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Fixture patch start channel")).toBeVisible();
  await expect(page.getByTestId("lighting-beam-fixture-key")).toHaveCount(0);
  await page.getByLabel("Fixture patch start channel").fill("3");
  // The palettes' own "Apply <name>" keys share the plate with the patch
  // panel's Apply, so the patch one is matched exactly.
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  // Every fixture is patched now, so patch mode ends by itself and its latch
  // goes; the fixture's plate says where it is patched.
  await expect(page.getByTestId("lighting-latch-patch")).toHaveCount(0);
  await expect(page.getByTestId("lighting-plate-patch-facts")).toContainText("003–004");
  await page.getByRole("button", { name: "Identify" }).click();
  await expect(page.getByRole("button", { name: /Bursting/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("lighting-placement-edit").click();
  await page.getByLabel("Beam angle in degrees").fill("42");
  await page.getByLabel("Beam angle in degrees").press("Enter");
  await expect(page.getByLabel("Beam angle in degrees")).toHaveValue("42");

  await openFixture(page, "lighting-empty");
  const emptyWorkspace = page.getByRole("main").first();
  await expect(emptyWorkspace.getByText("No fixtures on the rig yet")).toBeVisible();
  await page.getByRole("button", { name: "Add fixture…" }).first().click();
  const addFixtureDialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(addFixtureDialog.getByLabel("Name")).toHaveValue("Fixture 1");
  await addFixtureDialog.getByRole("button", { name: "Add fixture" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Fixture 1,/ })).toBeVisible();
});

test("surfaces patch collisions and auto-fixes them in lighting patch mode", async ({ page }) => {
  await openFixture(page, "lighting-patch-overlap");

  const workspace = page.getByRole("main").first();
  await openLightingPageMenu(page);
  await page.getByTestId("lighting-patch-toggle").click();

  const backFixture = page.getByRole("button", { name: /^Fixture Back,/ });
  await backFixture.focus();
  await page.keyboard.press("Enter");
  const patchInspector = page.getByLabel("Lighting inspector — Patch");
  await expect(patchInspector.getByText("Patch collision")).toBeVisible();
  await expect(patchInspector.getByText("Key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Auto-fix to 003" })).toBeVisible();

  await page.getByRole("button", { name: "Auto-fix to 003" }).click();
  await expect(page.getByRole("button", { name: /^Fixture Back,/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lighting-plate-patch-facts")).toContainText(/003–\d{3}/);
  await expect(workspace.getByText("Patch collision")).toHaveCount(0);
});

// The plot frames itself as Lighting opens, in a 200 ms animation that draws
// over a zoom made while it runs. The view has settled once the zoom readout
// holds still for longer than that.
async function settledZoom(readout: Locator): Promise<string> {
  // The readout always reads "N %", so the first read never matches this.
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await readout.innerText();
        const held = now === last;
        last = now;
        return held;
      },
      { intervals: [300] }
    )
    .toBe(true);
  return last;
}

test("persists lighting view bookmark slots through workspace changes", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  // Slice 3 review, finding 20. Old: after the click on the slot the case read
  // its aria-pressed, which says only that the slot is filled — true before the
  // click as after it — so a recall that moved nothing passed. New: the plot
  // toolbar's zoom readout, saved with the view, moved away from it, and back
  // after the recall.
  const readout = page.getByRole("toolbar", { name: "Stage plot view" }).locator("[aria-live='polite']");

  // New pages program, Slice 3 (D6). Old: Ctrl+Shift+1 saved view 1, with the
  // message "Saved view 1. Shift+1 recalls it.", the header's Ctrl+3 / Ctrl+2
  // went to the Console and back, and Shift+1 recalled the view. New: the view
  // slot's right-click menu saves the view (the message went with the key), the
  // header's tabs switch workspaces, and a click on the slot recalls it. Reason:
  // the keyboard shortcuts are gone; these are their twins (the inventory,
  // section 3). The zoom waits for the framing, so the saved view is not the
  // framed one that opening Lighting shows anyway.
  const framed = await settledZoom(readout);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(readout).not.toHaveText(framed);
  // The visual overhaul: a view's Save and Clear are the plot menu's (they
  // were a right-click on the slot alone).
  await expect(page.getByRole("button", { name: "View 1 is empty" })).toBeVisible();
  await (await openPlotMenu(page)).getByRole("menuitem", { name: "Save the view to 1" }).click();
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toHaveAttribute("aria-pressed", "true");
  const saved = await readout.innerText();

  // New pages program, Slice 1: Planning has left the screen, so the way out
  // and back is the Console. Old: the Planning workspace.
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("button", { name: "Audio", exact: true }).click();
  await expectWorkspaceMounted(page, "audio");
  await nav.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(page.getByRole("button", { name: /Recall view 1/ })).toBeVisible();

  // Lighting is drawn afresh and framed again. Move the view away from the
  // saved one with a zoom key — a mode key would re-frame over the recall — and
  // again if the click landed in the framing animation, which draws over it.
  await expect(async () => {
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(readout).not.toHaveText(saved, { timeout: 250 });
  }).toPass();
  await page.getByRole("button", { name: /Recall view 1/ }).click();
  await expect(readout).toHaveText(saved);
});

test("supports lighting drag-lasso multi-select and group save", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  // New pages program, Slice 3 (decision 10). Old: Shift+Enter on the focused
  // marker added Fill to the selection. New: with the plot toolbar's Add to
  // selection key lit, Enter on the focused marker (a plain press) adds it.
  // Reason: a key held with a press is a shortcut, and it went; the toggle is
  // its twin on screen.
  const addToSelection = page.getByTestId("lighting-add-to-selection");
  await addToSelection.click();
  await expect(addToSelection).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Fixture Fill,/ }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("Selected fixtures", { exact: true }).getByText("2 fixtures selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear the selection" })).toBeVisible();

  await page.getByRole("button", { name: "Create a new lighting group" }).click();
  const createGroupDialog = page.getByRole("dialog", { name: "New lighting group" });
  await expect(createGroupDialog.getByLabel("Group name")).toBeFocused();
  await createGroupDialog.getByLabel("Group name").fill("Group 3");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Group 3, 0 fixtures, off\. Toggle on\.$/i })).toBeVisible();
});

// The visual overhaul (2026-10-04): with nothing selected the plate shows the
// scene: its word on the rig, Recall, Save changes while the rig has left it,
// what it holds and the fixtures it holds. Saving a new scene is the Save row's
// alone (the plate's Save as new went).
test("the scene's plate: its word, Recall and Save changes, and the fixtures it holds", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await page.getByRole("button", { name: "Clear the selection" }).click();

  const plate = page.getByTestId("lighting-plate");
  await expect(page.getByTestId("lighting-plate-head")).toContainText("Warm wash");
  await expect(page.getByTestId("lighting-plate-scene-word")).toHaveText("on rig");
  await expect(plate.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
  await expect(plate.getByRole("button", { name: "Save as new", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("lighting-plate-scene-facts")).toContainText("3 of 4");
  await plate.getByRole("button", { name: "Open fixture settings for Fill" }).click();
  await expect(page.getByTestId("lighting-plate-head")).toContainText("Fill");
});

// New pages program, Slice 3 (decision 9): the case that moved the selected
// fixture with the arrow keys wherever focus was went with the page-wide arrows.
// The focused Stage X and Stage Y labels take the arrows (the case below), and
// `no-shortcuts.spec.ts` presses the arrows with nothing focused.

// The visual overhaul (2026-10-04): the placement is one readout row on the
// plate; its fields open beside it (Edit…, or the fixture menu's Edit
// placement…), each committing on Enter. The Stage X / Y labels that took the
// arrows went with the fields' old row.
test("edits a fixture's placement in the fields beside the plate", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await expect(page.getByTestId("lighting-plate-placement")).toContainText("0.24 m");
  await page.getByTestId("lighting-placement-edit").click();
  const popover = page.getByTestId("lighting-placement-popover");
  await expect(popover).toBeVisible();
  const stageX = popover.getByLabel("Stage X position in metres");
  await expect(stageX).toHaveValue("0.24");
  await stageX.fill("0.5");
  await stageX.press("Enter");
  await expect(page.getByTestId("lighting-plate-placement")).toContainText("0.5 m");

  // The fixture menu's Edit placement… opens the same fields.
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await (await openPlateMenu(page)).getByRole("menuitem", { name: "Edit placement…" }).click();
  await expect(page.getByTestId("lighting-placement-popover")).toBeVisible();
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
  // New pages program, Slice 3 (decision 8): the dialog has a "Reset to 100 %"
  // key too, and "Set" alone would name it as well ("Reset" holds "set").
  await dialog.getByRole("button", { name: "Set value", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(intensity).toHaveAttribute("aria-valuenow", "42");
});

// The review of the Lighting page's redraw (2026-10-04): the hardware link
// took a fixture's control map whole, and the plate sent the one control
// changed, so on the INFINIBAR Green reset Red. The plate sends every control
// with the one changed; since 2026-10-05 the hardware link also lays a map over
// the one it holds, so a control left out keeps its value either way.
test("a catalog control's commit keeps the fixture's other controls", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await page.getByRole("button", { name: /^Fixture Back,/ }).click();
  await expect(page.getByTestId("lighting-plate-head")).toContainText("Back");
  // Back is off in the scene, and an off fixture's levels wait.
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Red", exact: true })).not.toHaveAttribute("aria-disabled", "true");

  for (const [label, value] of [
    ["Red", "200"],
    ["Green", "100"],
  ] as const) {
    await page.getByRole("slider", { name: label, exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Set ${label}` });
    await dialog.getByRole("spinbutton").fill(value);
    await dialog.getByRole("button", { name: "Set value", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("slider", { name: label, exact: true })).toHaveAttribute("aria-valuenow", value);
  }
  await expect(page.getByRole("slider", { name: "Red", exact: true })).toHaveAttribute("aria-valuenow", "200");
});

test("opens lighting intensity typed entry via a bare double-click", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const intensity = page.getByRole("slider", { name: "Fixture intensity" });
  // A plain double-click opens typed entry. New pages program, Slice 3
  // (decision 8): the way back to the default is the dialog's Reset key (below);
  // the Alt+double-click and Backspace / Delete resets are gone.
  await intensity.dblclick();
  await expect(page.getByRole("dialog", { name: /Set Fixture intensity/i })).toBeVisible();
});

// New pages program, Slice 3 (decision 8): Backspace or Delete on a focused
// fixture slider, and Alt+double-click, reset it to its default. They went with
// the keys held and the shortcuts; the typed entry offers "Reset to 100 %"
// beside Cancel and Set value, and the colour temperature's goes to the middle
// of the fixture's range.
test("the typed entry's Reset key puts a fixture slider back to its default", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  const intensity = page.getByRole("slider", { name: "Fixture intensity" });
  await expect(intensity).toHaveAttribute("aria-valuenow", "76");
  await intensity.focus();
  await page.keyboard.press("Enter");
  const intensityDialog = page.getByRole("dialog", { name: /Set Fixture intensity/i });
  await intensityDialog.getByRole("button", { name: "Reset to 100 %", exact: true }).click();
  await expect(intensityDialog).toBeHidden();
  await expect(intensity).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByRole("button", { name: /^Fixture Key, 100 percent,/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  // Key is an Astra Bi-Color, 3200 K to 5600 K: the middle is 4400 K.
  const cct = page.getByRole("slider", { name: "Fixture CCT" });
  await expect(cct).toHaveAttribute("aria-valuenow", "3200");
  await cct.focus();
  await page.keyboard.press("Enter");
  const cctDialog = page.getByRole("dialog", { name: /Set Fixture CCT/i });
  await cctDialog.getByRole("button", { name: "Reset to 4400 K", exact: true }).click();
  await expect(cctDialog).toBeHidden();
  await expect(cct).toHaveAttribute("aria-valuenow", "4400");
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
  // The plot rests on the content frame. The drag below is measured in the
  // room's metres, so fit the room first (Fill screen, which stretched the room
  // out of shape, went with the visual overhaul) and wait for it to settle.
  await (await openPlotMenu(page)).getByRole("menuitemradio", { name: "Fit the room" }).click();
  await expect(page.locator('[data-inner-content="true"]')).toHaveAttribute("transform", "translate(0 0) scale(1)");

  const fixture = page.getByRole("button", { name: /^Fixture Key,/ });
  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  // The room's scale: pixels per metre at Fit room.
  const pixelsPerMetre = await page
    .locator('[data-inner-content="true"]')
    .evaluate((node) => (node as SVGGraphicsElement).getScreenCTM()!.a * 100);
  const start = await fixture.evaluate((node) => {
    const marker = node.querySelector("[data-marker-body]");
    if (!(marker instanceof SVGGraphicsElement)) throw new Error("Fixture marker body not found");
    const matrix = marker.getScreenCTM();
    if (!matrix) throw new Error("Fixture marker matrix not available");

    return { x: matrix.e, y: matrix.f };
  });
  const startOutputTransform = await output.getAttribute("transform");

  // From (0.24, 0.26) m by (1.26, 0.74) m: the drop snaps to (1.5, 1.0) m.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 1.26 * pixelsPerMetre, start.y + 0.74 * pixelsPerMetre, { steps: 8 });
  await expect.poll(async () => output.getAttribute("transform")).not.toBe(startOutputTransform);
  await page.mouse.up();
  expect(await output.getAttribute("transform")).not.toBe(startOutputTransform);

  await expect(page.getByTestId("lighting-plate-placement")).toContainText("1.5 m");
  await expect(page.getByTestId("lighting-plate-placement")).toContainText("1 m");
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
  // The room fitted, as above; the angle a drag makes does not depend on the
  // scale any more, since the room keeps its shape.
  await (await openPlotMenu(page)).getByRole("menuitemradio", { name: "Fit the room" }).click();
  await expect(page.locator('[data-inner-content="true"]')).toHaveAttribute("transform", "translate(0 0) scale(1)");

  const placement = page.getByTestId("lighting-plate-placement");
  await expect(placement).toContainText("0°");

  const output = page.locator('[data-fixture-output-id="fixture-key"]');
  const startOutputTransform = await output.getAttribute("transform");
  const handle = page.locator('[data-fixture-rotate-handle="fixture-key"]');
  await expect(handle).toBeVisible();
  const points = await handle.evaluate((node) => {
    const circle = node.querySelector("circle");
    const marker = node.closest("[data-fixture-id]");
    const body = marker?.querySelector("[data-marker-body]");
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
  // Production readiness S13. Old: the field was read once, straight after the
  // pointer came up. New: wait for it to leave 0 first. Reason: the field shows
  // the fixture's stored rotation, which moves when the reply to the drag's
  // commit has been fetched, not when the pointer comes up; a read that beat
  // the reply saw 0 (runs 34487837771 and 34595097112).
  await page.getByTestId("lighting-placement-edit").click();
  const rotationInput = page.getByLabel("Fixture rotation in degrees");
  await expect(rotationInput).not.toHaveValue("0");
  const draggedRotation = Number(await rotationInput.inputValue());
  expect(draggedRotation, "the rotate handle drag lands near a right angle").toBeGreaterThanOrEqual(78);
  expect(draggedRotation, "the rotate handle drag lands near a right angle").toBeLessThanOrEqual(88);

  await rotationInput.fill("270");
  await rotationInput.press("Enter");
  await expect(rotationInput).toHaveValue("270");
  await expect(page.locator('[data-fixture-id="fixture-key"] [data-marker-body]').first()).toHaveAttribute(
    "transform",
    /rotate\(270\)/
  );
});

// New pages program, Slice 3 (D6): the case that opened the full DMX monitor
// with Ctrl+Shift+M went with the key. The cluster's "DMX monitor" key and the
// strip's expand key open it (the case below, which also closes it with Esc —
// Esc closes a dialog, D6).

test("opens the compact DMX strip and expands it to the full monitor", async ({ page }) => {
  await openFixture(page, "lighting-populated");

  await openLightingPageMenu(page);
  await page.getByTestId("lighting-dmx-strip-toggle").click();
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
  await expect(stateDisplay).toContainText(/has not passed its probe, so recalls are refused/);
  await expect(page.getByTestId("lighting-state-setup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Identify" })).toBeDisabled();

  await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);
  // The visual overhaul: CUT ALL arms, as the deck's ALL OFF does (3 s), and
  // cuts at the second press; until then a dialog asked.
  const cut = page.getByRole("button", { name: "Cut all fixtures to 0 %" });
  await cut.click();
  await expect(cut).toHaveAttribute("data-armed", "true");
  await expect(page.getByTestId("lighting-state-display")).toContainText("Cut all fixtures · press again");
  await page.clock.fastForward(ARM_DWELL_MS + 50);
  await cut.click();
  await page.clock.resume();
  // Visual overhaul A, Slice 5. Old: the master card printed "All fixtures off"
  // and "Master · 0 / 4 on". New: the cluster's Lighting key says it is off and
  // nothing is lit, and the state display's meta line carries the count.
  // Reason: the master card is the cluster's key and hero now.
  await expect(page.getByTestId("lighting-power-toggle")).toContainText("nothing lit");
  await expect(page.getByRole("button", { name: /^Fixture Key, off,/ })).toHaveAttribute("aria-pressed", "true");
});

// 2026-10-05: a cut outside Preview ends the identify flashes on the hardware
// link, a Find's waiting ones too, and the page's Find ends with it: the key
// reads Find again at once. Before, it read Stop over a dark rig until the
// sequence's planned end (the page's clock is paused here, so that end never
// comes).
test("CUT ALL during a Find ends it: the Find key reads Find again", async ({ page }) => {
  await page.clock.install();
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");
  await pausePageClock(page);
  // All four lights, so the Find runs 1.9 s, longer than the cut's dwell.
  await page.getByTestId("lighting-add-to-selection").click();
  for (const name of ["Fill", "Back", "Warm wash"]) {
    await page.getByRole("button", { name: new RegExp(`^Fixture ${name},`) }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByLabel("Selected fixtures", { exact: true }).getByText("4 fixtures selected")).toBeVisible();
  const find = page.getByTestId("lighting-identify-find");
  await find.click();
  await expect(find).toHaveText("Stop");
  await pressTwice(page, page.getByRole("button", { name: "Cut all fixtures to 0 %" }));
  await expect(page.getByTestId("lighting-power-toggle")).toContainText("nothing lit");
  await expect(find).toHaveText("Find");
});

test("frames the populated rig via the stage-plot Frame mode (DENSITY-04)", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expect(page.getByTestId("lighting-stage")).toBeVisible();

  const inner = page.locator('[data-inner-content="true"]');
  const IDENTITY = "translate(0 0) scale(1)";

  // The plot rests on the content frame: the rig is zoomed and panned to fill
  // the well, so the inner transform is not the identity. The visual overhaul:
  // the framing is the plot menu's (Frame the rig, Fit the room).
  await expect(inner).not.toHaveAttribute("transform", IDENTITY);
  let menu = await openPlotMenu(page);
  await expect(menu.getByRole("menuitemradio", { name: "Frame the rig" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "Fit the room" }).click();
  await expect(inner).toHaveAttribute("transform", IDENTITY);

  menu = await openPlotMenu(page);
  await expect(menu.getByRole("menuitemradio", { name: "Fit the room" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "Frame the rig" }).click();
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
