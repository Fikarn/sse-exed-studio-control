import type {
  LightingFixtureCatalogSnapshot,
  LightingFixtureDefinitionSnapshot,
  LightingFixtureModeSnapshot,
  LightingFixtureSnapshot,
} from "@sse/engine-client";

export function getFixtureDefinition(
  catalog: LightingFixtureCatalogSnapshot | null | undefined,
  fixture: Pick<LightingFixtureSnapshot, "definitionId" | "type" | "kind"> | null | undefined
): LightingFixtureDefinitionSnapshot | null {
  if (!catalog || !fixture) return null;
  const alias = normalizeCatalogAlias(fixture.definitionId || fixture.type || fixture.kind);
  return (
    catalog.definitions.find((definition) => definition.id === fixture.definitionId) ??
    catalog.definitions.find((definition) => definition.id === alias) ??
    null
  );
}

export function getFixtureMode(
  definition: LightingFixtureDefinitionSnapshot | null | undefined,
  modeId: string | null | undefined
): LightingFixtureModeSnapshot | null {
  if (!definition) return null;
  return (
    definition.modes.find((mode) => mode.id === modeId) ??
    definition.modes.find((mode) => mode.id === definition.defaultModeId) ??
    definition.modes[0] ??
    null
  );
}

export function getFixtureModeForFixture(
  catalog: LightingFixtureCatalogSnapshot | null | undefined,
  fixture: Pick<LightingFixtureSnapshot, "definitionId" | "modeId" | "type" | "kind"> | null | undefined
) {
  const definition = getFixtureDefinition(catalog, fixture);
  return getFixtureMode(definition, fixture?.modeId);
}

export function selectableFixtureDefinitions(catalog: LightingFixtureCatalogSnapshot | null | undefined) {
  return (catalog?.definitions ?? []).filter(
    (definition) => definition.status === "verified" && definition.kind !== "control-node"
  );
}

export function fixtureDefinitionLabel(definition: LightingFixtureDefinitionSnapshot | null | undefined) {
  return definition?.displayName || definition?.model || definition?.id || "Fixture";
}

export function fixtureModeLabel(mode: LightingFixtureModeSnapshot | null | undefined) {
  if (!mode) return "Unknown mode";
  return `${mode.channelCount} ch · ${mode.displayName}`;
}

export function normalizeCatalogAlias(value: string | null | undefined) {
  const cleaned = (value ?? "").trim().toLowerCase().replace(/[_ ]+/g, "-");
  switch (cleaned) {
    case "astra":
    case "astra-bi-color":
    case "astra-bicolor":
    case "litepanels-astra":
      return "litepanels-astra-bicolor";
    case "infinimat":
    case "aputure-infinimat":
      return "aputure-infinimat-generic";
    case "infinibar":
    case "infinibar-pb12":
    case "aputure-infinibar-pb12":
      return "aputure-infinibar-pb12";
    case "apollo-bridge":
    case "litepanels-apollo":
    case "litepanels-apollo-bridge":
      return "litepanels-apollo-bridge";
    default:
      return cleaned;
  }
}
