import { afterEach, describe, expect, it } from "vitest";

import { isPeakWellWrite, writePeakWell } from "./AudioMeterCanvasOverlay";

// The paint loop writes a strip's held peak into its well at every frame of a
// moving peak. The page's observers (the loop's own, the pictures' places)
// watch the page for nodes that come and go, so the number must change as a
// text node's value and never as a new node (the audit of 2026-10-12: every
// write replaced the node, and the page was measured again at every frame).

function peakWell() {
  const element = document.createElement("span");
  element.dataset.peakWellId = "audio-input-9";
  element.dataset.peakWellKind = "channel";
  const value = document.createElement("span");
  value.dataset.peakWellValue = "";
  element.append(value);
  document.body.append(element);
  return { element, value };
}

const delivered = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("a peak well's number", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("moves inside one text node, so the page's observers see no new node", async () => {
    const well = peakWell();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.body, { childList: true, subtree: true });

    writePeakWell(well, -12);
    await delivered();
    const first = well.value.textContent;
    expect(first).not.toBe("");
    expect(records.filter((record) => record.type === "childList")).toHaveLength(1);

    writePeakWell(well, -11.4);
    writePeakWell(well, -6);
    writePeakWell(well, Number.NEGATIVE_INFINITY);
    await delivered();
    expect(well.value.textContent).not.toBe(first);
    expect(well.value.childNodes).toHaveLength(1);
    expect(
      records.filter((record) => record.type === "childList"),
      "the first write makes the node; the ones after it move its value"
    ).toHaveLength(1);
    observer.disconnect();
  });

  it("is the loop's own writing, and nothing else on the page is", () => {
    const well = peakWell();
    writePeakWell(well, -12);
    const strip = document.createElement("div");
    strip.dataset.testid = "audio-strip-audio-input-9";
    document.body.append(strip);

    expect(isPeakWellWrite(well.value.firstChild as Node)).toBe(true);
    expect(isPeakWellWrite(well.value)).toBe(true);
    expect(isPeakWellWrite(well.element)).toBe(true);
    expect(isPeakWellWrite(strip)).toBe(false);
    expect(isPeakWellWrite(document.body)).toBe(false);
  });
});
