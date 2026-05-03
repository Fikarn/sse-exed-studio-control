import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { getFixtureDefinition } from "./fixtureCatalog";

export type FixtureMounting = "bar" | "control-node" | "fresnel" | "mat" | "panel";

export function deriveMounting(
  fixture: string | Pick<LightingFixtureSnapshot, "definitionId" | "type" | "kind">,
  catalog?: LightingFixtureCatalogSnapshot | null
): FixtureMounting {
  if (typeof fixture !== "string") {
    const shape = getFixtureDefinition(catalog, fixture)?.visual.shape;
    if (shape === "bar" || shape === "control-node" || shape === "fresnel" || shape === "mat" || shape === "panel") {
      return shape;
    }
  }
  const t = (typeof fixture === "string" ? fixture : fixture.type).trim().toLowerCase();
  if (t.includes("apollo")) return "control-node";
  if (t.includes("infinimat")) return "mat";
  if (t.includes("infinibar")) return "bar";
  if (t.includes("astra")) return "panel";
  return "fresnel";
}
