import { expect, test } from "@playwright/test";

import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// New pages program, Slice 3 (D6 and the twelve decisions of 2026-09-26): the
// Console binds no key of its own, so what the keys did is done on screen.
// These cases cover what the slice added or changed to make that so:
//   - decision 3: the Inputs heading's Previous bank / Next bank keys, which
//     page both rows as `[` and `]` did (without them Line 1–8 could not be
//     reached on screen);
//   - decision 10: a plain click switches a group chip on or off, several can
//     be lit, and a key held while clicking changes nothing;
//   - decision 8: typed entry's "Reset to <default>" key, which replaces
//     Backspace / Delete and Alt+double-click;
//   - decision 9: a focused fader takes the arrows (one step, Shift or not),
//     Home and End.
// At 2560 × 1440 a bank holds 4 inputs and 6 playback pairs; the desk has 12
// inputs and 6 playback pairs, so the rows have three banks: Host, Co-host,
// Guest 1 and Guest 2 on bank 1, Line 1, Line 2, Remote A and Remote B on bank
// 2, Line 5–8 on bank 3.

test("the Inputs heading's bank keys page both rows, reach Line 1–8 and are dimmed at the ends", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  const inputsHeading = page.getByTestId("audio-tier-label-hardware-inputs");
  const previous = page.getByTestId("audio-bank-previous");
  const next = page.getByTestId("audio-bank-next");
  const bankReadout = page.getByTestId("audio-tier-bank-pill-hardware-inputs");
  const footer = page.getByTestId("audio-footer-telemetry");

  // Bank 1: the keys are there, beside the bank readout the heading prints on
  // every bank once there is more than one. One pair, on the Inputs heading only.
  await expect(inputsHeading.getByTestId("audio-bank-previous")).toBeVisible();
  await expect(inputsHeading.getByTestId("audio-bank-next")).toBeVisible();
  await expect(page.getByTestId("audio-tier-label-software-playback").getByTestId("audio-bank-next")).toHaveCount(0);
  await expect(previous).toHaveAccessibleName("Previous bank");
  await expect(next).toHaveAccessibleName("Next bank");
  await expect(bankReadout).toHaveText("Bank 1 / 3 · ch 1-4 of 12");
  // The readout leaves room for the mix the row sends into, in full.
  await expect(page.getByTestId("audio-tier-mix-for-hardware-inputs")).toContainText("sends into Main Out");
  await expect
    .poll(() =>
      page
        .getByTestId("audio-tier-mix-for-hardware-inputs")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
    )
    .toBe(true);
  await expect(footer).toContainText("1 of 3");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toBeVisible();

  // Bank 2: Line 1 and Line 2 on the Inputs row; the Playback row pages too.
  await next.click();
  await expect(footer).toContainText("2 of 3");
  await expect(bankReadout).toContainText("Bank 2 / 3");
  await expect(page.getByTestId("audio-strip-audio-input-1")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-2")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toHaveCount(0);
  await expect(page.getByTestId("audio-tier-lanes-software-playback")).toContainText("No playback on this bank.");
  await expect(previous).toBeEnabled();
  await expect(next).toBeEnabled();
  // Paging is not a click on the heading: the selected strip stays selected.
  await expect(page.getByRole("heading", { name: "FX 3/4" })).toBeVisible();

  // Bank 3: Line 5–8, and Next bank is dimmed at the last bank.
  await next.click();
  await expect(footer).toContainText("3 of 3");
  await expect(bankReadout).toContainText("Bank 3 / 3");
  for (const line of [5, 6, 7, 8]) {
    await expect(page.getByTestId(`audio-lane-name-audio-input-${line}`)).toHaveText(`Line ${line}`);
  }
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();

  // Back to bank 1: both rows as they started, Previous bank dimmed again.
  await previous.click();
  await expect(footer).toContainText("2 of 3");
  await previous.click();
  await expect(footer).toContainText("1 of 3");
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toBeVisible();
  await expect(previous).toBeDisabled();

  // With one bank there is nothing to page: lit to Talent, the Inputs row fits
  // one bank, and so does the Playback row, so the keys go until it is unlit.
  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  await expect(footer).toContainText("all 12 strips");
  await expect(page.getByTestId("audio-bank-keys")).toHaveCount(0);
  await page.getByTestId("audio-tier-chip-inputs-talent").click();
  await expect(page.getByTestId("audio-bank-keys")).toBeVisible();
});

test("a plain click lights two group chips at once, a second click turns one off, and a held key changes nothing", async ({
  page,
}) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  const fx = page.getByTestId("audio-tier-chip-playback-fx");
  const bed = page.getByTestId("audio-tier-chip-playback-bed");
  const program = page.getByTestId("audio-strip-audio-playback-1-2");
  const fxStrip = page.getByTestId("audio-strip-audio-playback-3-4");
  const music = page.getByTestId("audio-strip-audio-playback-7-8");
  const remote = page.getByTestId("audio-strip-audio-playback-9-10");

  await expect(fx).toHaveAttribute("data-active", "false");
  await expect(bed).toHaveAttribute("data-active", "false");

  await fx.click();
  await expect(fx).toHaveAttribute("data-active", "true");
  await expect(fxStrip).toBeVisible();
  await expect(program).toHaveCount(0);

  // A second chip lights beside the first; both groups' strips show.
  await bed.click();
  await expect(fx).toHaveAttribute("data-active", "true");
  await expect(bed).toHaveAttribute("data-active", "true");
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(bed).toHaveAttribute("aria-pressed", "true");
  await expect(fxStrip).toBeVisible();
  await expect(program).toBeVisible();
  await expect(music).toBeVisible();
  await expect(remote).toHaveCount(0);

  // A second click turns that chip off and leaves the other lit.
  await fx.click();
  await expect(fx).toHaveAttribute("data-active", "false");
  await expect(bed).toHaveAttribute("data-active", "true");
  await expect(fxStrip).toHaveCount(0);
  await expect(program).toBeVisible();

  // No chip lit: every strip shows.
  await bed.click();
  await expect(bed).toHaveAttribute("data-active", "false");
  await expect(fxStrip).toBeVisible();
  await expect(remote).toBeVisible();

  // Alt+click used to invert the row's chips. A key held while clicking is a
  // shortcut too, and it went: the click lights that one chip, no more.
  await fx.click({ modifiers: ["Alt"] });
  await expect(fx).toHaveAttribute("data-active", "true");
  await expect(bed).toHaveAttribute("data-active", "false");
  await fx.click();
  await expect(fx).toHaveAttribute("data-active", "false");
});

test("typed entry offers Reset to the default on a knob, the strip's Gain key and a fader", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  // The plate's preamp gain knob (the fixture's Host is at 32 dB; the default
  // is 24 dB). The strip is selected on its name, clear of its fader.
  await page.getByTestId("audio-strip-audio-input-9").click({ position: { x: 12, y: 12 } });
  const heroGain = page.getByTestId("audio-inspector-hardware-mini").getByRole("slider", { name: "Host preamp gain" });
  const stripGain = page.getByTestId("audio-lane-gain-audio-input-9");
  await expect(heroGain).toHaveAttribute("aria-valuenow", "32");
  await heroGain.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "Set Host preamp gain" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reset to 24 dB" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(heroGain).toHaveAttribute("aria-valuenow", "24");
  await expect(stripGain).toContainText("24 dB");

  // The strip's Gain key: type 40 dB, then Reset puts it back on 24 dB.
  await stripGain.click();
  dialog = page.getByRole("dialog", { name: "Set Host preamp gain" });
  await dialog.getByLabel("Preamp gain").fill("40");
  await dialog.getByRole("button", { name: "Set value" }).click();
  await expect(stripGain).toContainText("40 dB");
  await stripGain.click();
  dialog = page.getByRole("dialog", { name: "Set Host preamp gain" });
  await dialog.getByRole("button", { name: "Reset to 24 dB" }).click();
  await expect(stripGain).toContainText("24 dB");

  // A strip fader: type -10 dB, then Reset puts it back on unity, 0 dB.
  const fxFader = page.getByRole("slider", { name: "FX 3/4 send level" });
  const fxReadout = page.getByTestId("audio-lane-readout-audio-playback-3-4");
  await fxFader.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Set FX 3/4 send level" });
  await dialog.getByLabel("Fader level").fill("-10");
  await dialog.getByRole("button", { name: "Set value" }).click();
  // Whole-text checks: "-10.0 dB" contains "0.0 dB".
  await expect(fxReadout).toHaveText("-10.0 dB");
  await fxFader.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Set FX 3/4 send level" });
  await dialog.getByRole("button", { name: "Reset to 0 dB" }).click();
  await expect(fxReadout).toHaveText("0.0 dB");
});

test("a focused fader takes one plain step for Shift+ArrowUp, and Home and End reach its ends", async ({ page }) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  // The strip fader (the design system's groove): aria-valuenow is 0–100 and
  // one arrow step is 1.
  const stripFader = page.getByRole("slider", { name: "FX 3/4 send level" });
  const stripBefore = Number(await stripFader.getAttribute("aria-valuenow"));
  expect(stripBefore, "the fixture's FX 3/4 send leaves room for a step up").toBeLessThan(95);
  await stripFader.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(stripFader).toHaveAttribute("aria-valuenow", String(stripBefore + 1));
  await page.keyboard.press("Home");
  await expect(stripFader).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("End");
  await expect(stripFader).toHaveAttribute("aria-valuenow", "100");

  // The plate's send to the same mix (the Console's own slider): aria-valuenow
  // is 0–1 and one arrow step is 0.01.
  const plateSend = page.getByRole("slider", { name: "FX 3/4 send to Main Out" });
  await page.keyboard.press("Home");
  await expect(stripFader).toHaveAttribute("aria-valuenow", "0");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "0");
  await plateSend.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "0.01");
  await page.keyboard.press("End");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("Home");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "0");
});
