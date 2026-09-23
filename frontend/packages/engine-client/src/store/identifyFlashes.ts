// Identify and Find light a fixture for a set time. The hardware link stores
// each flash with its start and length and works out at every read whether it
// is still lit (`native/rust-engine/src/lighting/identify.rs`,
// `active_identify_burst_ids`); it announces nothing when a flash starts or
// ends. So a page that read the lighting state during a flash went on showing
// it — the light at 100 % and "Scene drift: unsaved" — until something else
// refreshed Lighting, and a Find showed its first flash only (a finding
// recorded 2026-09-22 under `a598b11`). The store reads the lighting state again
// at the moments these functions give.

/** The hardware link's cap on a Find (`MAX_IDENTIFY_SEQUENCE_FIXTURES`). */
const MAX_SEQUENCE_FIXTURES = 64;

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The moments, in milliseconds after the reply, at which an Identify or a Find
 * changes what `lighting.snapshot` shows: every flash's end, and every flash's
 * start but the first (the reply's own read shows that one). Read from the
 * reply: `lighting.fixture.identify` gives `durationMs`;
 * `lighting.fixture.identifySequence` gives `fixtureCount`, `stepMs` and
 * `durationMs`, one flash per fixture a step apart. Anything else gives none.
 */
export function identifyFlashMoments(reply: unknown): number[] {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return [];
  }
  const record = reply as Record<string, unknown>;
  const durationMs = nonNegative(record.durationMs);
  if (durationMs === null) {
    return [];
  }
  const fixtureCount = nonNegative(record.fixtureCount);
  const stepMs = nonNegative(record.stepMs);
  const moments = new Set<number>();
  if (fixtureCount === null || stepMs === null) {
    moments.add(durationMs);
  } else {
    const flashes = Math.min(Math.floor(fixtureCount), MAX_SEQUENCE_FIXTURES);
    for (let index = 0; index < flashes; index += 1) {
      moments.add(index * stepMs);
      moments.add(index * stepMs + durationMs);
    }
  }
  return [...moments].filter((moment) => moment > 0).sort((left, right) => left - right);
}
