import type { LightingSnapshot } from "@sse/engine-client";

// Lighting's latches, as words the pages draw (2026-10-09, the Overview, D47):
// a highlight and a solo on fixtures are the hardware link's overlays, held in
// its snapshot, so the Overview shows them in its latch slot as Lighting does,
// with the same Off. Patch is the Lighting page's own mode and leaves with it,
// so it is not here.

/** `Key light, Fill and 3 more`: two names and how many more. */
export function latchNames(list: readonly string[]): string {
  if (list.length <= 2) return list.join(", ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

export interface LightingLatchView {
  id: "highlight" | "solo";
  who: "Highlight" | "Solo";
  /** The fixtures it holds, as `latchNames` writes them. */
  text: string;
  names: string[];
}

/** The overlays held on the rig: a highlight, then a solo. Off ends either. */
export function lightingLatches(
  snapshot: Pick<LightingSnapshot, "fixtures" | "highlightFixtureIds" | "soloFixtureIds"> | null
): LightingLatchView[] {
  if (!snapshot) return [];
  const namesOf = (ids: readonly string[]) => {
    const held = new Set(ids);
    return snapshot.fixtures.filter((fixture) => held.has(fixture.id)).map((fixture) => fixture.name);
  };
  const latches: LightingLatchView[] = [];
  const highlighted = namesOf(snapshot.highlightFixtureIds ?? []);
  if (highlighted.length > 0) {
    latches.push({ id: "highlight", who: "Highlight", text: latchNames(highlighted), names: highlighted });
  }
  const soloed = namesOf(snapshot.soloFixtureIds ?? []);
  if (soloed.length > 0) {
    latches.push({ id: "solo", who: "Solo", text: latchNames(soloed), names: soloed });
  }
  return latches;
}
