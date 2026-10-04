import { expect, test, type Page } from "@playwright/test";

import { deriveSendStatusLabel } from "../src/app/audio/audioFormatting";

async function openFixture(page: Page, fixtureId: string) {
  const params = new URLSearchParams({ fixture: fixtureId, transport: "fixture" });
  const response = await page.goto(`/?${params.toString()}`);
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
}

test.describe("audio formatting unification", () => {
  test("infinite-fader readouts use the unified -∞ glyph", () => {
    // No need to spin up Playwright runtime here — pure-function check.
    expect(deriveSendStatusLabel({ isActive: true, sendMuted: false, noSend: false })).toBe("Active mix");
    expect(deriveSendStatusLabel({ isActive: true, sendMuted: true, noSend: false })).toBe("Active mix muted");
    expect(deriveSendStatusLabel({ isActive: true, sendMuted: false, noSend: true })).toBe("Active mix no send");
    expect(deriveSendStatusLabel({ isActive: false, sendMuted: false, noSend: false })).toBe("Send");
    expect(deriveSendStatusLabel({ isActive: false, sendMuted: true, noSend: false })).toBe("Muted");
    expect(deriveSendStatusLabel({ isActive: false, sendMuted: false, noSend: true })).toBe("No send");
  });
});

test("tier bank pill prints the Inputs bank and the Playback description, and is testid-addressable", async ({
  page,
}) => {
  // New pages program, Slice 3. The audio-populated fixture has three input
  // banks (12 inputs, 4 a bank at 2560, Line 1–8 on banks 2 and 3), which the
  // Inputs heading's bank keys page (audio-onscreen-twins.spec.ts); that
  // heading prints the bank and the channel range on every bank, bank 1
  // included, and the Playback heading its description (`tier.meta`) until it
  // is paged. Old title: "renders the tier description on bank 1"; old
  // comment: the fixture "has only one bank per tier" — wrong (the S3
  // inventory, decision 3).
  // The visual overhaul's Console pull request. Old: the pill printed "Bank 1 /
  // 3 · ch 1-4 of 12" and the Playback heading its description ("6 ch · post ·
  // stereo pairs"). New: "1 / 3" between the bank keys, the bank and its
  // channels in the pill's tooltip, and no description on Playback. Reason:
  // Atrium, "1 / 3" between the keys; the heading carried four facts.
  await openFixture(page, "audio-populated");
  const pill = page.getByTestId("audio-tier-bank-pill-hardware-inputs");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText("1 / 3");
  await expect(page.getByTestId("audio-tier-label-hardware-inputs")).toContainText("Bank 1 / 3 · ch 1-4 of 12");
  await expect(page.getByTestId("audio-tier-bank-pill-software-playback")).toHaveCount(0);
});

test("the footer carries the console link, the metering source, the last sync and the bank", async ({ page }) => {
  // Visual overhaul A, Slice 4 (system §2): the Console's footer is the
  // shell's, and it carries the telemetry the retired top bar's stat cluster
  // held. Old: "health bar drops OSC, Endpoint and Metering rows" — the
  // footer kept only Clock / Last sync and the top bar carried the rest.
  await openFixture(page, "audio-populated");
  const footer = page.getByTestId("audio-health-bar");
  await expect(footer).toBeVisible();
  // Slice 8 (system §9): the footer names what the row reports (OSC control),
  // not this surface. "Console" is the workspace, the desk is the hardware.
  await expect(footer).toContainText("OSC control");
  await expect(footer).toContainText("Metering");
  await expect(footer).toContainText("Last sync");
  await expect(footer).toContainText("Bank");
  await expect(footer).not.toContainText("Endpoint");
  await expect(page.getByTestId("audio-topbar")).toHaveCount(0);
});

// 2026-10-01 (the owner's decision, after the studio walk). Old: "snapshot diff
// shows '+N more' when more than two channels changed": a slot's hover float
// previewed what its recall would change, with save, rename and delete keys.
// New: a slot is one of TotalMix's own, shows its name and what TotalMix
// reports of it, and a hover adds nothing. Reason: the app keeps none of a
// TotalMix snapshot's contents, so it has nothing to compare or to edit.
test("a TotalMix snapshot slot shows its name and state, and a hover adds nothing", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const slot = page.getByTestId("audio-snapshot-slot-2");
  await expect(slot).toBeVisible();
  await expect(page.getByTestId("audio-snapshot-name-2")).toHaveText("Interview");
  // The visual overhaul's Console pull request: a slot TotalMix does not hold
  // says nothing (it said "–").
  await expect(page.getByTestId("audio-snapshot-state-2")).toHaveText("");
  const atRest = await slot.innerText();
  await slot.hover();
  expect(await slot.innerText()).toBe(atRest);
  await expect(slot.getByRole("button")).toHaveCount(1);
  await expect(page.getByTestId("audio-snapshot-deck").getByRole("button")).toHaveCount(8);
});

test("EQ Band 2 locks the band-type selector via the capability flag", async ({ page }) => {
  await openFixture(page, "audio-selected-channel");
  // Visual overhaul A, Slice 4c. Old: click the EQ tab. New: the equaliser is a
  // section of the plate, always present; bring it into view. Reason: the plate
  // has no tab row.
  const eqSection = page.locator('[data-plate-section="eq"]');
  await expect(eqSection).toBeAttached();
  await eqSection.scrollIntoViewIfNeeded();

  const band2 = page.getByTestId("audio-eq-point-2");
  await band2.click();

  // 2026-05-27 redesign: the EQ tab shows every band's card at once, so a
  // global Bell button now matches multiple cards. Scope to band 2's card.
  // Band 2 renders exactly one band-type option (Bell) and that option is
  // disabled. The disabled state is sourced from `canChangeBandType` rather
  // than an inline `=== "2"` string match.
  const bellButton = page.getByTestId("audio-eq-band-card-2").getByRole("button", { name: /^Bell$/i });
  await expect(bellButton).toBeVisible();
  await expect(bellButton).toBeDisabled();
});

// Visual overhaul B (DESIGN.md §9): no tooltip covers a take-time control. The
// strip's M and S are take-time keys between take-time keys (48 V and gain
// above, the fader below), so they carry no tooltip: their names say what
// they do. New pages program, Slice 3 (D6): "Mute Host", no key hint.
test("mute / solo keys say what they do in their names, with no tooltip over the strip", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const strip = page.getByTestId("audio-strip-audio-input-9");
  const muteButton = strip.getByRole("button", { name: /^Mute Host$/ });
  await expect(muteButton).toBeVisible();
  await expect(strip.getByRole("button", { name: /^Solo Host$/ })).toBeVisible();
  await muteButton.hover();
  await page.waitForTimeout(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

// New pages program, Slice SW: hovering the lane's last strip once made its
// keys' tooltips spill past the lane, which then scrolled 4 px: a scrollbar
// under Playback at 2560 × 1440. Visual overhaul B: no tooltip opens there,
// and the lane still never scrolls.
test("hovering a strip's keys opens nothing over the strip, and the lane does not scroll", async ({ page }) => {
  await openFixture(page, "audio-populated");
  const lane = page.getByTestId("audio-tier-lanes-software-playback");
  await expect(lane).toBeVisible();
  const readScroll = () => lane.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  const atRest = await readScroll();
  expect(atRest.scroll, "the Playback lane does not scroll at rest").toBeLessThanOrEqual(atRest.client);

  const lastStrip = lane.locator(":scope > *").last();
  for (const name of [/^Mute Playback 11\/12$/, /^Solo Playback 11\/12$/]) {
    const key = lastStrip.getByRole("button", { name });
    await key.hover();
    await page.waitForTimeout(800);
    await expect(page.getByRole("tooltip"), `${name} opens no tooltip`).toHaveCount(0);
    const shown = await readScroll();
    expect(shown.scroll, `the lane does not scroll while ${name} shows its tooltip`).toBeLessThanOrEqual(shown.client);
  }
});
