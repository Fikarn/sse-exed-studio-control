import { expect, type Page } from "@playwright/test";

// plan PR 4 / workstream D4: audio meter helpers — canvas sampling for
// post-tick visual asserts, dBFS label inventory checks. Used by audio
// meter tests only, but kept under helpers/ so future Vitest unit tests
// (D3) can re-export the pure-logic pieces.

export const EXPECTED_DBFS_SCALE_LABELS = ["0", "-6", "-12", "-18", "-24", "-40", "-60"];

export function meterNormalizedForDbfs(dbfs: number) {
  return 10 ** (dbfs / 20);
}

export async function readMeterCanvasSample(page: Page, hostTestId: string) {
  const trackBox = await page.getByTestId(hostTestId).locator('[data-meter-track="left"]').first().boundingBox();
  expect(trackBox, `${hostTestId} meter track should be measurable`).not.toBeNull();

  return page.getByTestId("audio-meter-canvas").evaluate((canvas, rect) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context || !rect) {
      return { checksum: 0, count: 0, sequence: "" };
    }

    const canvasRect = element.getBoundingClientRect();
    const scaleX = element.width / Math.max(1, canvasRect.width);
    const scaleY = element.height / Math.max(1, canvasRect.height);
    const x = Math.max(0, Math.floor((rect.x - canvasRect.x) * scaleX));
    const y = Math.max(0, Math.floor((rect.y - canvasRect.y) * scaleY));
    const width = Math.max(1, Math.min(element.width - x, Math.ceil(rect.width * scaleX)));
    const height = Math.max(1, Math.min(element.height - y, Math.ceil(rect.height * scaleY)));
    const data = context.getImageData(x, y, width, height).data;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 17) {
      checksum = (checksum + data[index] * (index + 1)) % 1_000_000_007;
    }

    return {
      checksum,
      count: Number.parseInt(element.dataset.meterCount ?? "0", 10),
      sequence: element.dataset.meterSequence ?? "",
    };
  }, trackBox);
}

export async function expectDbfsScaleLabelsInsideMeters(page: Page, label: string) {
  const meterAudit = await page.locator('[data-meter-component="stereo"]').evaluateAll((meters, expectedLabels) => {
    const tolerance = 1;
    return meters.map((meter, meterIndex) => {
      const meterElement = meter as HTMLElement;
      const meterRect = meterElement.getBoundingClientRect();
      const meterStyle = getComputedStyle(meterElement);
      const scale = meterElement.querySelector<HTMLElement>('[data-meter-scale="dbfs"]');
      const scaleRect = scale?.getBoundingClientRect() ?? null;
      const scaleLabels = scale
        ? Array.from(scale.querySelectorAll<HTMLElement>("[data-meter-scale-mark]")).map((scaleLabel, labelIndex) => {
            const labelRect = scaleLabel.getBoundingClientRect();
            const mark = scaleLabel.dataset.meterScaleMark ?? scaleLabel.textContent?.trim() ?? "";
            const insideMeter =
              labelRect.left >= meterRect.left - tolerance &&
              labelRect.top >= meterRect.top - tolerance &&
              labelRect.right <= meterRect.right + tolerance &&
              labelRect.bottom <= meterRect.bottom + tolerance;
            const insideScale =
              scaleRect !== null &&
              labelRect.left >= scaleRect.left - tolerance &&
              labelRect.top >= scaleRect.top - tolerance &&
              labelRect.right <= scaleRect.right + tolerance &&
              labelRect.bottom <= scaleRect.bottom + tolerance;

            return {
              insideMeter,
              insideScale,
              labelIndex,
              mark,
              position: getComputedStyle(scaleLabel).getPropertyValue("--meter-scale-position").trim(),
            };
          })
        : [];

      return {
        expectedLabels,
        id: meterElement.dataset.meterId ?? meterElement.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
        labels: scaleLabels.map((entry) => entry.mark),
        scaleCount: meterElement.querySelectorAll('[data-meter-scale="dbfs"]').length,
        scaleLabels,
        visible:
          meterRect.width > 0 &&
          meterRect.height > 0 &&
          meterStyle.display !== "none" &&
          meterStyle.visibility !== "hidden",
        meterIndex,
      };
    });
  }, EXPECTED_DBFS_SCALE_LABELS);

  const visibleMeters = meterAudit.filter((entry) => entry.visible);
  expect(visibleMeters.length, `${label} visible stereo meters`).toBeGreaterThan(0);
  expect(
    visibleMeters.filter((entry) => entry.scaleCount !== 1),
    `${label} every visible meter should expose exactly one dBFS scale`
  ).toEqual([]);

  for (const entry of visibleMeters) {
    expect(entry.labels, `${label} ${entry.id || `meter ${entry.meterIndex}`} scale labels`).toEqual(
      EXPECTED_DBFS_SCALE_LABELS
    );
  }

  const clippedLabels = visibleMeters.flatMap((entry) =>
    entry.scaleLabels
      .filter((scaleLabel) => !scaleLabel.insideMeter || !scaleLabel.insideScale)
      .map((scaleLabel) => ({
        id: entry.id || `meter ${entry.meterIndex}`,
        insideMeter: scaleLabel.insideMeter,
        insideScale: scaleLabel.insideScale,
        mark: scaleLabel.mark,
      }))
  );
  expect(clippedLabels, `${label} clipped dBFS scale labels`).toEqual([]);

  const clippedBoundaryLabels = visibleMeters.flatMap((entry) =>
    entry.scaleLabels
      .filter((scaleLabel) => scaleLabel.mark === "0" || scaleLabel.mark === "-60")
      .filter((scaleLabel) => !scaleLabel.insideMeter || !scaleLabel.insideScale)
      .map((scaleLabel) => ({
        id: entry.id || `meter ${entry.meterIndex}`,
        mark: scaleLabel.mark,
      }))
  );
  expect(clippedBoundaryLabels, `${label} boundary dBFS scale labels`).toEqual([]);
}
