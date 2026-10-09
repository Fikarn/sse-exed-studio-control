import { expect, test, type Page } from "@playwright/test";

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

// Slice 3 review (#6): the dialog hides on a restart too, and the fixture's
// restart is back on the same Setup step within milliseconds, so the screen
// alone cannot tell a kept link from a restarted one. The startup handshake
// can: it asks `engine.ping` once per start, and nothing else asks it.
test("Restart the hardware link… in Setup / Support asks first; Esc and Cancel keep the link", async ({ page }) => {
  await page.addInitScript(() => {
    window.__SSE_TEST_ENGINE_REQUEST_COUNTS__ = {};
  });
  await openFixture(page, "setup-required");
  await expectWorkspaceMounted(page, "setup");
  const pings = () => page.evaluate(() => window.__SSE_TEST_ENGINE_REQUEST_COUNTS__?.["engine.ping"] ?? 0);
  const pingsAtStart = await pings();
  expect(pingsAtStart, "the startup handshake is counted").toBeGreaterThan(0);
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
  expect(await pings(), "Esc must not restart the hardware link").toBe(pingsAtStart);

  await restartKey.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();
  expect(await pings(), "Cancel must not restart the hardware link").toBe(pingsAtStart);
});

test("Setup's modes, steps and the Map's pages and deck keys answer clicks", async ({ page }) => {
  await openFixture(page, "setup-required");
  await expectWorkspaceMounted(page, "setup");

  await page.getByTestId("setup-mode-support").click();
  await expect(page.getByRole("heading", { name: "Backup and recovery" })).toBeVisible();
  await page.getByTestId("setup-mode-runner").click();
  await expect(page.getByRole("heading", { name: "Import the Companion profile" })).toBeVisible();

  // Import, then Probe, then Map, the way the operator walks them.
  await page.getByRole("button", { name: "Export and continue" }).click();
  await expect(page.getByText(/Exported Companion profile to/)).toBeVisible();
  await page.getByRole("tab", { name: /Probe hardware/i }).click();
  await expect(page.getByRole("heading", { name: "Probe hardware" })).toBeVisible();
  await page.getByLabel("Lighting bridge IP").fill("192.168.1.80");
  await page.getByTestId("setup-run-all-probes").click();
  await expect(page.getByRole("heading", { name: "Map bindings" })).toBeVisible();

  // D5: the deck's pages are LIGHTS, AUDIO, CAMERAS and PROMPTER, so page 1 opens on
  // LIGHTS' first key, `REC` (top left on every page since 2026-10-03), and page 2 is AUDIO.
  const deckKey = (label: string) =>
    page
      .getByTestId("setup-deck-keys")
      .locator("button")
      .filter({ has: page.getByText(label, { exact: true }) });
  await expect(deckKey("REC")).toHaveAttribute("data-selected", "true");

  await page.getByRole("button", { name: "AUDIO", exact: true }).click();
  await expect(deckKey("REC")).toHaveAttribute("data-selected", "true");

  await deckKey("PHONES").click();
  await expect(deckKey("PHONES")).toHaveAttribute("data-selected", "true");
  await expect(deckKey("REC")).toHaveAttribute("data-selected", "false");

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

  // Consumer: a portaled dialog's title reads the word step (20 px, docs/DESIGN.md
  // section 3), so it must render at 20px * 1.25 = 25px rather than the
  // unscaled 20px.
  // The visual overhaul: Add fixture… is the Lighting page ⋯'s.
  await page.getByTestId("lighting-page-menu").click();
  await page.getByTestId("lighting-add-fixture").click();
  const dialog = page.getByRole("dialog", { name: "Add fixture" });
  await expect(dialog).toBeVisible();
  const titleSize = await dialog
    .locator("h2")
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize);
  expect(titleSize).toBe("25px");
});

// GLO-09: latched cross-workspace state (audio SOLO, lighting scene drift)
// surfaces as persistent attention chips in the shell monitor strip instead of
// being guarded only by the async leave-prompt. Both flags derive from engine
// snapshots, so the chips survive workspace switches. The shell (overhaul 3):
// a latch is not printed in the header on the page that shows it itself —
// Solo stands in the Console's latch slot there.
test("audio solo latches a monitor-strip chip that survives workspace switches", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const soloChip = page.getByRole("button", { name: /Open Audio for Solo/ });
  const soloLatch = page.getByTestId("audio-latch-slot").getByTestId("audio-solo-warning-band");
  // The fixture transport's synthesized bank ships FX 3/4 pre-soloed, so the
  // latch is part of the designed rest state: in the latch slot, not the header.
  await expect(soloLatch).toBeVisible();
  await expect(soloChip).toHaveCount(0);

  const soloButton = page.getByTestId("audio-strip-audio-playback-3-4").getByRole("button", { name: "Solo FX 3/4" });
  await expect(soloButton).toHaveAttribute("aria-pressed", "true");
  await soloButton.click();
  await expect(soloButton).toHaveAttribute("aria-pressed", "false");
  await expect(soloLatch).toHaveCount(0);
  await expect(page.getByTestId("audio-latch-slot")).toContainText("Nothing latched");

  // Re-latch and confirm the chip stands on every other page.
  await soloButton.click();
  await expect(soloLatch).toBeVisible();
  await page.getByRole("button", { name: "Teleprompter", exact: true }).click();
  await expect(soloChip).toBeVisible();
  await expect(page.getByTestId("shell-lamp-latched-solo")).toHaveText("Solo");
  // The polish (2026-10-05): Lighting has a Solo of its own, so there the
  // Console's latch says whose it is.
  await page.getByRole("button", { name: "Lighting", exact: true }).click();
  await expect(page.getByTestId("lighting-stage")).toBeVisible();
  const audioSoloChip = page.getByRole("button", { name: /Open Audio for Audio solo/ });
  await expect(audioSoloChip).toBeVisible();
  await expect(page.getByTestId("shell-lamp-latched-solo")).toHaveText("Audio solo");

  // The chip's click target is the owning workspace, not Setup.
  await audioSoloChip.click();
  await expect(page.getByTestId("audio-workspace")).toBeVisible();
  await expect(soloChip).toHaveCount(0);
});

// The shell (overhaul 3): a drifted scene is the rig's state display's word on
// Lighting, and the Lighting tab's word everywhere else; a chip of its own only
// when a worse state holds the tab's word (it is never printed twice).
test("lighting scene drift is the Lighting tab's word on the other pages", async ({ page }) => {
  await openFixture(page, "lighting-populated");
  const driftChip = page.getByRole("button", { name: /Open Lighting for Scene drift/ });
  await expect(driftChip).toHaveCount(0);

  // Toggle the Front group off — the rig now diverges from the recalled
  // Warm wash scene; restoring the group clears it.
  await page.getByRole("button", { name: /^Front, 2 fixtures at 67 %, on/ }).click();
  await expect(page.getByTestId("lighting-state-display")).toContainText("UNSAVED");
  await expect(driftChip).toHaveCount(0);
  await page.getByRole("button", { name: "Audio", exact: true }).click();
  // The rig's page asks before it is left with a drifted scene; the rig stays as it is.
  await page.getByRole("button", { name: "Leave anyway" }).click();
  await expectWorkspaceMounted(page, "audio");
  await expect(page.getByTestId("shell-lamp-lighting")).toContainText("unsaved");
  await expect(driftChip).toHaveCount(0);
  await page.getByRole("button", { name: "Lighting", exact: true }).click();
  await expectWorkspaceMounted(page, "lighting");
  await page.getByRole("button", { name: /^Front, 2 fixtures/ }).click();
  await expect(page.getByTestId("lighting-state-display")).not.toContainText("UNSAVED");
});

// Visual overhaul A, Slice 2 (plan D1, finding C3): the header lamp mirrors
// the worst state its workspace shows — `ACTION FAILED` is red in the header
// too. Visual overhaul A, Slices 4a and 5: the workspace's state is its state
// display. The shell (overhaul 3): the lamp is the page's tab's word, and the
// active tab carries none, because the page's own display says it; so the
// lamp is read from another page. This case also stands for the per-page lamp
// words the Cameras, Lighting and Teleprompter specs read on their own page
// before.
for (const { fixture, tab, label, band, tone, word } of [
  {
    fixture: "lighting-dmx-unreachable",
    tab: "lighting",
    label: "Lighting",
    band: "lighting-state-display",
    tone: "error",
    word: "unreachable",
  },
  {
    fixture: "lighting-bridge-silent",
    tab: "lighting",
    label: "Lighting",
    band: "lighting-state-display",
    tone: "attention",
    word: "not answering",
  },
  {
    fixture: "audio-offline",
    tab: "audio",
    label: "Audio",
    band: "audio-state-display",
    tone: "error",
    word: "offline",
  },
  {
    fixture: "audio-action-failed",
    tab: "audio",
    label: "Audio",
    band: "audio-state-display",
    tone: "error",
    word: "action failed",
  },
  {
    fixture: "cameras-unreachable",
    tab: "cameras",
    label: "Cameras",
    band: "cameras-state-display",
    tone: "error",
    word: "unreachable",
  },
  {
    fixture: "cameras-released",
    tab: "cameras",
    label: "Cameras",
    band: "cameras-state-display",
    tone: "attention",
    word: "released",
  },
  {
    fixture: "cameras-no-link",
    tab: "cameras",
    label: "Cameras",
    band: "cameras-state-display",
    tone: "attention",
    word: "not set up",
  },
  {
    fixture: "cameras-picture-missing",
    tab: "cameras",
    label: "Cameras",
    band: "cameras-state-display",
    tone: "attention",
    word: "picture missing",
  },
  {
    fixture: "teleprompter-not-connected",
    tab: "prompter",
    label: "Teleprompter",
    band: "teleprompter-state-display",
    tone: "error",
    word: "not connected",
  },
  {
    fixture: "teleprompter-not-updated",
    tab: "prompter",
    label: "Teleprompter",
    band: "teleprompter-state-display",
    tone: "attention",
    word: "not updated",
  },
]) {
  test(`the ${label} tab's word is the page's state, and the open page's tab carries none, on ${fixture}`, async ({
    page,
  }) => {
    await openFixture(page, fixture);
    const workspaceBand = page.getByTestId(band);
    await expect(workspaceBand).toBeVisible();
    await expect(workspaceBand).toHaveAttribute("data-tone", tone);
    const lamp = page.getByTestId(`shell-lamp-${tab}`);
    await expect(lamp).toHaveCount(0);
    await page.locator('[data-nav-id="setup"]').click();
    await expect(page.getByTestId("setup-state-display")).toBeVisible();
    const tabButton = page.locator('[data-region="header"]').getByRole("button", { name: label, exact: true });
    await expect(tabButton.getByTestId(`shell-lamp-${tab}`)).toHaveAttribute("data-tone", tone);
    await expect(tabButton.getByTestId(`shell-lamp-${tab}`)).toContainText(word);
  });
}

// Visual overhaul A, Slice 2 (plan D1, finding H1): Setup / Support is a
// workspace inside the one shell — the same header, tabs and lamps — and
// once commissioning is published the operator can leave it from the tabs.
test("Setup renders inside the shell with tabs and lamps", async ({ page }) => {
  await openFixture(page, "setup-ready");
  await expect(page.getByRole("tablist", { name: "Commissioning runner" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(page.locator('[data-nav-id="setup"]')).toHaveAttribute("aria-current", "page");
  for (const id of ["lighting", "audio", "surface"]) {
    await expect(page.getByTestId(`shell-lamp-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("shell-clock")).toHaveText(/^\d\d:\d\d$/);
  const header = page.locator('[data-region="header"]');
  const headerBox = await header.boundingBox();
  expect(Math.abs((headerBox?.height ?? 0) - 88), "header height within 2 px of section 2").toBeLessThanOrEqual(2);
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
  // The visual overhaul (2026-10-05): the whole sentence stands in the bay.
  await expect(page.getByTestId("workspace-boundary-bay")).toContainText("The rest of Studio Control keeps working");
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
  LightingWorkspace: "lighting-scenes-section",
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

// The polish (2026-10-05): the open tab keeps the room of its word, so no tab
// moves when the page changes and the tab just pressed stays under the
// pointer (DESIGN §1).
test("no tab moves when the page changes", async ({ page }) => {
  await openFixture(page, "setup-ready");
  // The skylight (D48): the pages' platter and the system's, Setup / Support on the latter.
  const header = page.locator('[data-region="header"]');
  // The baseline once the shell is ready: before it, the tabs carry other
  // words (pending), and the faces may still be loading.
  await expectWorkspaceMounted(page, "setup");
  await expect(page.locator('[data-nav-id="setup"]')).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => document.fonts.ready);
  const lefts = () =>
    header.evaluate((element) =>
      [...element.querySelectorAll("[data-nav-id]")].map((tab) => Math.round(tab.getBoundingClientRect().left))
    );
  const first = await lefts();
  for (const label of ["Lighting", "Audio", "Cameras", "Teleprompter", "Setup / Support"]) {
    await header.getByRole("button", { name: label, exact: true }).click();
    await expect(header.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await lefts(), `the tabs on ${label}`).toEqual(first);
  }
});

// The skylight (D48, 2026-10-09; until then the test of the header with the
// cameras): the fullest header is Setup's, where every page's tab carries its
// word, with the deck, the latches and the REC tally lit. A drifted scene is
// the Lighting tab's word, the prompter's play its tab's. Left to right: the
// logotype at the frame's margin with its clear space, the rule, the pages'
// platter, the room left over, the system's platter (the deck, the latches,
// Setup / Support), the REC tally and the clock at the frame's margin; nothing
// cut.
test.describe("the header, the skylight", () => {
  const recChip = (page: Page) => page.getByTestId("shell-lamp-latched-rec");

  test("its fullest row fits: every tab's word, Solo, the prompter playing and REC together", async ({ page }) => {
    await openFixture(page, "every-page");
    await expectWorkspaceMounted(page, "cameras");
    await page.getByTestId("cameras-rec").click();
    await expect(recChip(page)).toBeVisible();

    await page.getByRole("button", { name: "Lighting", exact: true }).click();
    await expectWorkspaceMounted(page, "lighting");
    await page.getByRole("button", { name: /^Front, 2 fixtures at 67 %, on/ }).click();

    await page.getByRole("button", { name: "Teleprompter", exact: true }).click();
    // The lighting page asks before it is left with a scene that drifted.
    const leave = page.getByRole("button", { name: /Leave|Discard|Continue/ });
    if (await leave.count()) await leave.first().click();
    await expectWorkspaceMounted(page, "teleprompter");
    await expect(page.getByTestId("teleprompter-play")).not.toHaveAttribute("data-locked", "", { timeout: 10_000 });
    await page.getByTestId("teleprompter-play").click();

    await page.getByRole("button", { name: "Setup / Support", exact: true }).click();
    await expect(page.getByTestId("setup-state-display")).toBeVisible();
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("playing");
    await expect(page.getByTestId("shell-lamp-prompter")).toContainText("left");
    await expect(page.getByTestId("shell-lamp-latched-solo")).toBeVisible();
    await expect(recChip(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const row = await page.evaluate(() => {
      const header = document.querySelector('[data-region="header"]')!;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      const pages = header.querySelector('[data-platter="pages"]')!;
      const system = header.querySelector('[data-platter="system"]')!;
      const testIds = (element: Element) =>
        [...element.querySelectorAll('[data-testid^="shell-lamp-"]')].map((item) => item.getAttribute("data-testid"));
      return {
        header: box(header),
        logo: box(header.querySelector("img")!),
        rule: box(pages.previousElementSibling!),
        pages: box(pages),
        pagesClipped: pages.scrollWidth > pages.clientWidth,
        pageWords: testIds(pages),
        pageTabs: [...pages.querySelectorAll("[data-nav-id]")].map((tab) => tab.getAttribute("data-nav-id")),
        system: box(system),
        systemClipped: system.scrollWidth > system.clientWidth,
        systemLast:
          system.lastElementChild?.querySelector("[data-nav-id]")?.getAttribute("data-nav-id") ??
          system.lastElementChild?.getAttribute("data-nav-id"),
        chips: testIds(system),
        tally: box(header.querySelector('[data-testid="shell-rec-slot"]')!),
        clock: box(header.querySelector('[data-testid="shell-clock"]')!),
        headerClipped: header.scrollWidth > header.clientWidth,
      };
    });
    expect(row.pageTabs).toEqual(["lighting", "audio", "cameras", "teleprompter"]);
    expect(row.pageWords).toEqual([
      "shell-lamp-lighting",
      "shell-lamp-audio",
      "shell-lamp-cameras",
      "shell-lamp-prompter",
    ]);
    // Last on the system's platter, so it stays put while the latches change with the page.
    expect(row.systemLast, "Setup / Support ends the system's platter").toBe("setup");
    expect(row.chips).toEqual(["shell-lamp-surface", "shell-lamp-latched-solo"]);
    expect(row.headerClipped, "nothing in the header is cut").toBe(false);
    expect(row.pagesClipped, "no tab is cut").toBe(false);
    expect(row.systemClipped, "no chip is cut").toBe(false);
    expect(row.logo.left, "the logotype stands at the frame's margin").toBe(row.header.left + 32);
    expect(row.logo.bottom - row.logo.top, "the logotype is 40 px high").toBe(40);
    expect(row.rule.left - row.logo.right, "the logotype's clear space before the rule").toBeGreaterThanOrEqual(20);
    expect(row.pages.left, "the pages' platter after the rule").toBeGreaterThanOrEqual(row.rule.right + 20);
    expect(row.system.left - row.pages.right, "room to spare between the two platters").toBeGreaterThanOrEqual(16);
    expect(row.system.right, "the system's platter ends before the REC tally").toBeLessThanOrEqual(row.tally.left);
    expect(row.tally.right, "the REC tally ends before the clock").toBeLessThanOrEqual(row.clock.left);
    expect(Math.round(row.clock.right), "the clock keeps the frame's margin").toBe(row.header.right - 32);
    for (const platter of [row.pages, row.system, row.tally]) {
      expect(platter.bottom - platter.top, "a platter is 48 px high").toBe(48);
    }
  });

  test("the REC tally and the system's platter stand still when REC lights", async ({ page }) => {
    await openFixture(page, "every-page");
    await expectWorkspaceMounted(page, "cameras");
    const at = async () => ({
      slot: await page.getByTestId("shell-rec-slot").boundingBox(),
      surface: await page.getByTestId("shell-lamp-surface").boundingBox(),
      setup: await page.locator('[data-nav-id="setup"]').boundingBox(),
      clock: await page.getByTestId("shell-clock").boundingBox(),
    });
    const before = await at();
    await page.getByTestId("cameras-rec").click();
    await expect(recChip(page)).toBeVisible();
    await expect(recChip(page)).toHaveAttribute("data-tone", "error");
    expect(await at(), "nothing in the header moves when REC lights").toEqual(before);
  });

  test("the footer ends with the product's name, and the header names it nowhere", async ({ page }) => {
    await openFixture(page, "every-page");
    await expectWorkspaceMounted(page, "cameras");
    const colophon = page.getByTestId("shell-colophon");
    await expect(colophon).toHaveText("Studio Control");
    const ends = await page.evaluate(() => {
      const footer = document.querySelector('[data-region="footer"]')!.getBoundingClientRect();
      const name = document.querySelector('[data-testid="shell-colophon"]')!.getBoundingClientRect();
      return { footer: footer.right, name: name.right };
    });
    expect(Math.round(ends.name), "the colophon keeps the frame's margin").toBe(Math.round(ends.footer) - 32);
    await expect(page.locator('[data-region="header"]')).not.toContainText("Studio Control");
  });
});
