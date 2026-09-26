import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// plan PR 4 / workstream D4: shell-level specs split out of
// operator-shell.spec.ts. Covers the shell's own chrome and dialogs that aren't
// tied to any single workspace.
//
// New pages program, Slice 3 (D6): Studio Control binds no key of its own. Old:
// "supports shell keyboard overlays and workspace switching" drove the shortcut
// guide (?), Setup's Runner and Support (Shift+S), its steps (Tab, Shift+Tab),
// the Map's page and control keys (2, K), the restart dialog (Ctrl+Shift+R) and
// Ctrl+2. New: the two cases below reach the same things by clicks. Reason:
// the keys are gone (inventory §3) and every one had an on-screen twin; the
// guide went with the keys it listed. The palette's two cases and "shortcut
// labels follow the host platform" went with the palette and the hints.

test("Restart the hardware link… in Setup / Support asks first; Esc and Cancel keep the link", async ({ page }) => {
  await openFixture(page, "setup-required");
  await expectWorkspaceMounted(page, "setup");
  const restartKey = page.getByTestId("support-restart-bridge");
  const dialog = page.getByRole("dialog", { name: "Restart the hardware link?" });

  await restartKey.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("TotalMix and the lights keep their current state");
  // A click beside the dialog takes focus off it; Esc still closes it (the
  // shell's window key handler that used to catch this is gone).
  await page.mouse.click(8, 8);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await restartKey.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
});

test("Setup's modes, steps and the Map's pages and deck keys answer clicks", async ({ page }) => {
  await openFixture(page, "setup-required");
  await expectWorkspaceMounted(page, "setup");

  await page.getByTestId("setup-mode-support").click();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  await page.getByTestId("setup-mode-runner").click();
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  // Import, then Probe, then Map, the way the operator walks them.
  await page.getByRole("button", { name: "Download profile" }).click();
  await expect(page.getByText(/Exported Companion profile to/)).toBeVisible();
  await page.getByRole("tab", { name: /Probe hardware/i }).click();
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();
  await page.getByLabel("Lighting bridge IP").fill("192.168.1.80");
  await page.getByTestId("setup-run-all-probes").click();
  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();

  // New pages program, Slice 2: the deck's pages are LIGHTS and AUDIO (PROJECTS and
  // TASKS left with Planning), so page 1 opens on "Light 1" and page 2 is AUDIO.
  const deckKey = (label: string) =>
    page
      .getByTestId("setup-deck-keys")
      .locator("button")
      .filter({ has: page.getByText(label, { exact: true }) });
  await expect(deckKey("Light 1")).toHaveAttribute("data-selected", "true");

  await page.getByRole("button", { name: /^AUDIO/ }).click();
  await expect(deckKey("Channel 1")).toHaveAttribute("data-selected", "true");

  await deckKey("Channel 2").click();
  await expect(deckKey("Channel 2")).toHaveAttribute("data-selected", "true");
  await expect(deckKey("Channel 1")).toHaveAttribute("data-selected", "false");

  await page.getByRole("button", { name: /^Back to Probe hardware/ }).click();
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();
});

declare global {
  interface Window {
    __SSE_TEST_REQUEST_CLOSE__?: () => void;
  }
}

// 2026-09 audit remediation, Slice 11: README and OPERATIONS promised a close
// confirmation that did not exist — the X button killed the shell and the
// engine with it. The native shell now prevents the close and raises
// shell://close-requested; in the browser the same request comes through the
// window hook. The native close itself is operator-verified (checklist B8).
test("closing the window asks for confirmation; Cancel and Escape keep the session", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const workspace = page.getByTestId("lighting-workspace");
  await expect(workspace).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Close Studio Control?" });

  await page.evaluate(() => window.__SSE_TEST_REQUEST_CLOSE__?.());
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("TotalMix keeps its current state");
  await expect(dialog).toContainText("fixtures hold their last levels");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(workspace).toBeVisible();

  await page.evaluate(() => window.__SSE_TEST_REQUEST_CLOSE__?.());
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(workspace).toBeVisible();

  // Confirming outside Tauri only closes the dialog — there is no shell to
  // stop; in the native shell this is where shell_confirm_close runs.
  await page.evaluate(() => window.__SSE_TEST_REQUEST_CLOSE__?.());
  await dialog.getByRole("button", { name: "Close Studio Control" }).click();
  await expect(dialog).toBeHidden();
  await expect(workspace).toBeVisible();
});

// GLO-02 / CHROME-03 (the S2 "UI-scale escape" deferral, closed): the operator
// scale tokens are defined for `.root` AND for body[data-operator-scale-host]
// in one grouped rule, so overlays that portal to document.body (dialogs,
// drawers, context menu, color picker, toasts) now track the operator UI scale
// instead of silently falling back to unscaled DS tokens.
test("operator UI scale reaches portaled overlays", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("app.operator.uiScale", "125");
  });
  await openFixture(page, "lighting-populated");

  // Mechanism: the layout provider stamps body as the scale host.
  await expect(page.locator('body[data-operator-scale-host][data-ui-scale="125"]')).toHaveCount(1);

  // Consumer: a portaled dialog's title reads the A state step (24 px, visual
  // overhaul A Slice 3; old: the 22 px title-lg token → 27.5px), so it must
  // render at 24px * 1.25 = 30px rather than the unscaled 24px.
  await page.getByRole("button", { name: "Add fixture" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(dialog).toBeVisible();
  const titleSize = await dialog
    .locator("h2")
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize);
  expect(titleSize).toBe("30px");
});

// GLO-09: latched cross-workspace state (audio SOLO, lighting scene drift)
// surfaces as persistent attention chips in the shell monitor strip instead of
// being guarded only by the async leave-prompt. Both flags derive from engine
// snapshots, so the chips survive workspace switches.
test("audio solo latches a monitor-strip chip that survives workspace switches", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const soloChip = page.getByRole("button", { name: /Open Audio for Solo/ });
  // The fixture transport's synthesized bank ships FX 3/4 pre-soloed, so the
  // chip is part of the designed rest state.
  await expect(soloChip).toBeVisible();

  const soloButton = page.getByTestId("audio-strip-audio-playback-3-4").getByRole("button", { name: "Solo FX 3/4" });
  await expect(soloButton).toHaveAttribute("aria-pressed", "true");
  await soloButton.click();
  await expect(soloButton).toHaveAttribute("aria-pressed", "false");
  await expect(soloChip).toHaveCount(0);

  // Re-latch and confirm the chip survives leaving the audio workspace.
  await soloButton.click();
  await expect(soloChip).toBeVisible();
  await page.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  await expect(soloChip).toBeVisible();

  // The chip's click target is the owning workspace, not Setup.
  await soloChip.click();
  await expect(page.getByTestId("audio-workspace")).toBeVisible();
});

test("lighting scene drift latches a monitor-strip chip", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const driftChip = page.getByRole("button", { name: /Open Lighting for Scene drift/ });
  await expect(driftChip).toHaveCount(0);

  // Toggle the Front group off — the rig now diverges from the recalled
  // Warm wash scene, which must latch the drift chip; restoring the group
  // clears it.
  await page.getByRole("button", { name: /^Front, 2 fixtures at 67 %, on/ }).click();
  await expect(driftChip).toBeVisible();
  await page.getByRole("button", { name: /^Front, 2 fixtures/ }).click();
  await expect(driftChip).toHaveCount(0);
});

// Visual overhaul A, Slice 2 (plan D1, finding C3): the header lamp mirrors
// the worst state its workspace shows — `ACTION FAILED` is red in the header
// too. Until the state display lands (Slice 4), the workspace's state is its
// current band: the Console's warning band and the Lighting bridge banner.
// Visual overhaul A, Slice 4a. Old: both audio cases read
// `audio-warning-band`. New: they read `audio-state-display`. Reason: the
// Console's state, its sentence and its way out are the cluster's state
// display now, so the band the header lamp mirrored no longer exists. Lighting
// Visual overhaul A, Slice 5: Lighting's case moved the same way — the bridge
// banner became the rig's state display.
for (const { fixture, lamp, band, tone } of [
  { fixture: "lighting-dmx-unreachable", lamp: "shell-lamp-lighting", band: "lighting-state-display", tone: "error" },
  { fixture: "audio-offline", lamp: "shell-lamp-audio", band: "audio-state-display", tone: "error" },
  { fixture: "audio-action-failed", lamp: "shell-lamp-audio", band: "audio-state-display", tone: "error" },
]) {
  test(`the header lamp's tone equals the workspace's state tone on ${fixture}`, async ({ page }) => {
    await openFixture(page, fixture);
    const workspaceBand = page.getByTestId(band);
    await expect(workspaceBand).toBeVisible();
    await expect(workspaceBand).toHaveAttribute("data-tone", tone);
    await expect(page.getByTestId(lamp)).toHaveAttribute("data-tone", tone);
  });
}

// Visual overhaul A, Slice 2 (plan D1, finding H1): Setup / Support is a
// workspace inside the one shell — the same header, tabs and lamps — and
// once commissioning is published the operator can leave it from the tabs.
test("Setup renders inside the shell with tabs and lamps", async ({ page }) => {
  await openFixture(page, "setup-ready");
  await expect(page.getByText("Commissioning runner")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(nav.getByRole("button", { name: "Setup / Support", exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  );
  for (const id of ["lighting", "audio", "surface"]) {
    await expect(page.getByTestId(`shell-lamp-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("shell-clock")).toHaveText(/^\d\d:\d\d$/);
  const header = page.locator('[data-region="header"]');
  const headerBox = await header.boundingBox();
  expect(Math.abs((headerBox?.height ?? 0) - 56), "header height within 2 px of D4").toBeLessThanOrEqual(2);
  await nav.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
});

// 2026-09 production readiness, Slice 9 (finding F10): a render error inside a
// workspace used to leave a blank webview — header, tabs and dialogs gone with
// it. `?crash=lighting` (fixture double only) makes Lighting throw while it
// renders; the shell must survive it, Audio must stay usable, the failure must
// reach the attention band, and "Reload this area" must bring Lighting back
// once the fault is gone.
// New pages program, Slice 3 (D6). Old: Ctrl+Shift+R raised "Restart the
// hardware link?" over the failed area. New: the window's close request raises
// "Close Studio Control?", and Esc closes it. Reason: the key is gone; the
// close request is the shell dialog that every surface can still raise, and
// Setup's restart key is not on this page.
test("workspace crash keeps shell alive", async ({ page }) => {
  await openFixture(page, "audio-populated", { crash: "lighting" });
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  const boundary = page.getByTestId("workspace-boundary");
  const band = page.getByTestId("background-failure-band");
  await expect(page.getByTestId("audio-workspace")).toBeVisible();
  await expect(band).toHaveCount(0);

  await nav.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(boundary).toContainText("LIGHTING STOPPED");
  await expect(boundary).toContainText("The rest of Studio Control keeps working");
  await expect(page.getByTestId("lighting-stage")).toHaveCount(0);
  // The area failed, not the screen: the shell's own chrome is all still here.
  await expect(page.getByTestId("shell-boundary")).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Lighting", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("shell-clock")).toHaveText(/^\d\d:\d\d$/);
  await expect(page.getByTestId("shell-lamp-audio")).toBeVisible();
  await page.evaluate(() => window.__SSE_TEST_REQUEST_CLOSE__?.());
  const closeDialog = page.getByRole("dialog", { name: "Close Studio Control?" });
  await expect(closeDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(closeDialog).toBeHidden();
  await expect(band).toContainText("1 problem since");

  // Audio is one tab away and works.
  await nav.getByRole("button", { name: "Audio", exact: true }).click();
  await expect(page.getByTestId("audio-workspace")).toBeVisible();
  await expect(boundary).toHaveCount(0);
  const soloButton = page.getByTestId("audio-strip-audio-playback-3-4").getByRole("button", { name: "Solo FX 3/4" });
  await expect(soloButton).toHaveAttribute("aria-pressed", "true");
  await soloButton.click();
  await expect(soloButton).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("background-failure-dismiss").click();
  await expect(band).toHaveCount(0);

  // While the fault stands Lighting fails again, and says so again.
  await nav.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(boundary).toContainText("LIGHTING STOPPED");
  await expect(band).toContainText("2 problems since");

  // The fault goes away; reloading the area brings the workspace back whole.
  await page.evaluate(() => window.__SSE_TEST_DISARM_CRASH__?.());
  await page.getByTestId("workspace-boundary-reload").click();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  await expect(boundary).toHaveCount(0);
  await expect(page.locator('[data-region="footer"]')).toBeVisible();
});

// The hook is the fixture double's alone: without `?crash=` nothing is armed
// and nothing about it is on the window.
test("the crash hook is absent unless the fixture URL asks for it", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  expect(await page.evaluate(() => typeof window.__SSE_TEST_DISARM_CRASH__)).toBe("undefined");
  await expect(page.getByTestId("background-failure-band")).toHaveCount(0);
});

// Production readiness S14 (finding F26): every workspace used to be part of the
// one script the shell starts from, so every one was fetched and evaluated
// before the startup surface drew. Each is a chunk of its own now. The markers
// are test ids only that workspace draws: if a workspace is imported statically
// again its marker moves into the entry script and this fails. (New pages
// program, Slice 1: Planning and its chunk are gone.)
const WORKSPACE_CHUNKS = {
  LightingWorkspace: "lighting-stage-lock-note",
  AudioWorkspace: "audio-monitor-bar",
  SetupSupportPilot: "setup-screen-support",
} as const;

test("lazy workspace loads", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  await expectWorkspaceMounted(page, "lighting");

  // The active workspace's chunk is asked for once the shell has drawn, the
  // other two once it is ready and idle.
  const scriptUrls = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.endsWith(".js"))
    );
  for (const chunk of Object.keys(WORKSPACE_CHUNKS)) {
    await expect.poll(async () => (await scriptUrls()).some((url) => url.includes(`/assets/${chunk}-`))).toBe(true);
  }

  const entryUrl = await page.evaluate(
    () => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? ""
  );
  expect(entryUrl).toContain("/assets/index-");
  const entrySource = await (await page.request.get(entryUrl)).text();
  const urls = await scriptUrls();
  for (const [chunk, marker] of Object.entries(WORKSPACE_CHUNKS)) {
    const chunkUrl = urls.find((url) => url.includes(`/assets/${chunk}-`));
    expect(chunkUrl, `${chunk} should be a script of its own`).toBeTruthy();
    const chunkSource = await (await page.request.get(chunkUrl!)).text();
    expect(chunkSource, `${chunk} should carry its workspace`).toContain(marker);
    expect(entrySource, `the entry script should not carry ${chunk}`).not.toContain(marker);
  }

  // A workspace whose chunk is in hand mounts in the commit that asks for it:
  // the shell's loading surface is never drawn on the way to the Console.
  // New pages program, Slice 3 (D6). Old: Ctrl+3 asked for the Console. New:
  // a click on the "Audio" tab. Reason: the key is gone; the tab is its twin.
  await page.evaluate(() => {
    const seen = { loading: false };
    (window as unknown as { __sawWorkspaceLoading: typeof seen }).__sawWorkspaceLoading = seen;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="workspace-loading"]')) seen.loading = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Audio", exact: true })
    .click();
  await expectWorkspaceMounted(page, "audio");
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawWorkspaceLoading: { loading: boolean } }).__sawWorkspaceLoading.loading
    )
  ).toBe(false);
});
