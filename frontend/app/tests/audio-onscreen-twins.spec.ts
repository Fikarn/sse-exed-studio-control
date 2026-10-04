import { expect, test } from "@playwright/test";

import { openAudioTierMenu, readAudioTierGroup, toggleAudioTierGroup } from "./helpers/audio";
import { expectWorkspaceMounted, openFixture } from "./helpers/openFixture";

// New pages program, Slice 3 (D6 and the twelve decisions of 2026-09-26): the
// Console binds no key of its own, so what the keys did is done on screen.
// These cases cover what the slice added or changed to make that so:
//   - decision 3: the Inputs heading's Previous bank / Next bank keys, which
//     page both rows as `[` and `]` did (without them Line 1–8 could not be
//     reached on screen);
//   - decision 10: a plain click switches a group chip on or off, several can
//     be lit, a lit chip stays in the heading on every bank, and a key held
//     while clicking changes nothing (since the visual overhaul's Console pull
//     request the chips are the check items of the tier's ⋯, with the chips'
//     test ids);
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
  // The visual overhaul's Console pull request. Old: the readout printed "Bank
  // 1 / 3 · ch 1-4 of 12" and the heading "sends into Main Out". New: "1 / 3"
  // between the keys, the bank and its channels in its tooltip, and no "sends
  // into": the lit output in the cluster is the mix target. Reason: Atrium; the
  // heading carried four facts.
  await expect(bankReadout).toHaveText("1 / 3");
  await expect(inputsHeading).toContainText("Bank 1 / 3 · ch 1-4 of 12");
  await expect(page.getByTestId("audio-tier-mix-for-hardware-inputs")).toHaveCount(0);
  await expect(footer).toContainText("1 of 3");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-playback-1-2")).toBeVisible();

  // Bank 2: Line 1 and Line 2 on the Inputs row; the Playback row pages too.
  await next.click();
  await expect(footer).toContainText("2 of 3");
  await expect(bankReadout).toHaveText("2 / 3");
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
  await expect(bankReadout).toHaveText("3 / 3");
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
  await toggleAudioTierGroup(page, "hardware-inputs", "talent");
  await expect(footer).toContainText("all 12 strips");
  await expect(page.getByTestId("audio-bank-keys")).toHaveCount(0);
  await toggleAudioTierGroup(page, "hardware-inputs", "talent");
  await expect(page.getByTestId("audio-bank-keys")).toBeVisible();
});

test("a plain click lights two group chips at once, a second click turns one off, and a held key changes nothing", async ({
  page,
}) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  const program = page.getByTestId("audio-strip-audio-playback-1-2");
  const fxStrip = page.getByTestId("audio-strip-audio-playback-3-4");
  const music = page.getByTestId("audio-strip-audio-playback-7-8");
  const remote = page.getByTestId("audio-strip-audio-playback-9-10");
  const playback = "software-playback" as const;

  expect(await readAudioTierGroup(page, playback, "fx")).toBe("false");
  expect(await readAudioTierGroup(page, playback, "bed")).toBe("false");

  await toggleAudioTierGroup(page, playback, "fx");
  expect(await readAudioTierGroup(page, playback, "fx")).toBe("true");
  await expect(fxStrip).toBeVisible();
  await expect(program).toHaveCount(0);
  // A lit filter is said in the heading's words.
  await expect(page.getByTestId("audio-tier-filter-software-playback")).toHaveText("FX only");

  // A second group lights beside the first; both groups' strips show.
  await toggleAudioTierGroup(page, playback, "bed");
  expect(await readAudioTierGroup(page, playback, "fx")).toBe("true");
  expect(await readAudioTierGroup(page, playback, "bed")).toBe("true");
  await expect(page.getByTestId("audio-tier-filter-software-playback")).toHaveText("Bed, FX only");
  await expect(fxStrip).toBeVisible();
  await expect(program).toBeVisible();
  await expect(music).toBeVisible();
  await expect(remote).toHaveCount(0);

  // A second press turns that group off and leaves the other lit.
  await toggleAudioTierGroup(page, playback, "fx");
  expect(await readAudioTierGroup(page, playback, "fx")).toBe("false");
  expect(await readAudioTierGroup(page, playback, "bed")).toBe("true");
  await expect(fxStrip).toHaveCount(0);
  await expect(program).toBeVisible();

  // No group lit: every strip shows.
  await toggleAudioTierGroup(page, playback, "bed");
  expect(await readAudioTierGroup(page, playback, "bed")).toBe("false");
  await expect(fxStrip).toBeVisible();
  await expect(remote).toBeVisible();

  // Alt+click used to invert the row's chips. A key held while clicking is a
  // shortcut too, and it went: the press lights that one group, no more.
  await openAudioTierMenu(page, playback);
  await page.getByTestId("audio-tier-chip-playback-fx").click({ modifiers: ["Alt"] });
  expect(await readAudioTierGroup(page, playback, "fx")).toBe("true");
  expect(await readAudioTierGroup(page, playback, "bed")).toBe("false");
  await toggleAudioTierGroup(page, playback, "fx");
  expect(await readAudioTierGroup(page, playback, "fx")).toBe("false");
});

// Found on the slice's review: an Inputs bank holds one group here, so with
// Talent and Line both lit, a lit chip's strips can all be on another bank. The
// heading drew no chip for it there, and a click on the other chip switched
// both off (Talent then Line lit ended with nothing lit and all 12 inputs).
test("a lit Inputs chip stays in the heading on a bank without its strips, and a click turns off only that chip", async ({
  page,
}) => {
  await openFixture(page, "audio-populated");
  await expectWorkspaceMounted(page, "audio");

  const inputs = "hardware-inputs" as const;
  const heading = page.getByTestId("audio-tier-label-hardware-inputs");
  const bankReadout = page.getByTestId("audio-tier-bank-pill-hardware-inputs");
  const next = page.getByTestId("audio-bank-next");

  // Bank 2 has Line 1 and Line 2: light Line there, and the rows go back to
  // bank 1. The visual overhaul's Console pull request: the readout prints "1 /
  // 2" and its tooltip the bank and its channels (old: one line of both).
  await next.click();
  await expect(bankReadout).toHaveText("2 / 3");
  await toggleAudioTierGroup(page, inputs, "line");
  expect(await readAudioTierGroup(page, inputs, "line")).toBe("true");
  await expect(bankReadout).toHaveText("1 / 2");
  await expect(heading).toContainText("Bank 1 / 2 · ch 1-4 of 6");

  // Talent lights beside Line. Bank 1 holds no Line strip, and the lit Line
  // group stays in the menu.
  await toggleAudioTierGroup(page, inputs, "talent");
  expect(await readAudioTierGroup(page, inputs, "talent")).toBe("true");
  expect(await readAudioTierGroup(page, inputs, "line")).toBe("true");
  await expect(heading).toContainText("Bank 1 / 3 · ch 1-4 of 10");

  // A second press on Talent turns Talent off, and Line stays lit.
  await toggleAudioTierGroup(page, inputs, "talent");
  expect(await readAudioTierGroup(page, inputs, "talent")).toBe("false");
  expect(await readAudioTierGroup(page, inputs, "line")).toBe("true");
  await expect(heading).toContainText("Bank 1 / 2 · ch 1-4 of 6");

  // Both lit again, then bank 2, which holds no Talent strip: the lit Talent
  // group stays, and a press on Line leaves Talent lit.
  await toggleAudioTierGroup(page, inputs, "talent");
  await expect(heading).toContainText("Bank 1 / 3 · ch 1-4 of 10");
  await next.click();
  await expect(heading).toContainText("Bank 2 / 3 · ch 5-8 of 10");
  expect(await readAudioTierGroup(page, inputs, "talent")).toBe("true");
  await toggleAudioTierGroup(page, inputs, "line");
  expect(await readAudioTierGroup(page, inputs, "talent")).toBe("true");
  expect(await readAudioTierGroup(page, inputs, "line")).toBe("absent");
  // Talent alone fits one bank, so there is nothing to page.
  await expect(page.getByTestId("audio-bank-keys")).toHaveCount(0);
  await expect(page.getByTestId("audio-strip-audio-input-9")).toBeVisible();
  await expect(page.getByTestId("audio-strip-audio-input-1")).toHaveCount(0);
});

// The visual overhaul's Console pull request. Old name: "… on a knob, the
// strip's Gain key and a fader". New: the strip's gain is a value, and its
// menu's "Set preamp gain…" opens the same typed entry the key did.
test("typed entry offers Reset to the default on a knob, the strip's gain and a fader", async ({ page }) => {
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

  // The strip's gain, from its menu: type 40 dB, then Reset puts it back on 24 dB.
  const setGain = async () => {
    await page.getByTestId("audio-lane-menu-audio-input-9").click();
    await page.getByTestId("audio-lane-menu-audio-input-9-gain").click();
  };
  await setGain();
  dialog = page.getByRole("dialog", { name: "Set Host preamp gain" });
  await dialog.getByLabel("Preamp gain").fill("40");
  await dialog.getByRole("button", { name: "Set value" }).click();
  await expect(stripGain).toContainText("40 dB");
  await setGain();
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
  // The visual overhaul's Console pull request: unity reads "+0.0 dB", as the
  // deck's display prints it.
  await expect(fxReadout).toHaveText("+0.0 dB");
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

  // The visual overhaul's Console pull request. Old: the plate's send to the
  // same mix, the Console's own slider, read 0–1. New: the plate's sends are
  // the other mixes' (the mix target's send is the strip's fader, its one
  // home), on the design system's slider: 0–100, one arrow step is 1.
  await expect(page.getByRole("slider", { name: "FX 3/4 send to Main Out" })).toHaveCount(0);
  const plateSend = page.getByRole("slider", { name: "FX 3/4 send to Phones 1" });
  await plateSend.focus();
  await page.keyboard.press("Home");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("End");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Home");
  await expect(plateSend).toHaveAttribute("aria-valuenow", "0");
});
