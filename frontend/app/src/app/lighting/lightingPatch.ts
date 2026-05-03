import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import { getFixtureMode, getFixtureModeForFixture, normalizeCatalogAlias } from "./fixtureCatalog";

type FixturePatchIdentity =
  | string
  | Pick<LightingFixtureSnapshot, "definitionId" | "modeId" | "type" | "kind" | "universe" | "dmxStartAddress">;

function fallbackChannelCount(fixtureType: string) {
  switch (normalizeCatalogAlias(fixtureType)) {
    case "aputure-infinimat-generic":
      return 4;
    case "aputure-infinibar-pb12":
      return 8;
    case "litepanels-apollo-bridge":
      return 0;
    default:
      return 2;
  }
}

function fixtureMode(identity: FixturePatchIdentity, catalog?: LightingFixtureCatalogSnapshot | null) {
  if (typeof identity === "string") {
    const definition = (catalog?.definitions ?? []).find((entry) => entry.id === normalizeCatalogAlias(identity));
    return getFixtureMode(definition, undefined);
  }
  return getFixtureModeForFixture(catalog, identity);
}

export function lightingFixtureChannelCount(
  identity: FixturePatchIdentity,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  return (
    fixtureMode(identity, catalog)?.channelCount ??
    fallbackChannelCount(typeof identity === "string" ? identity : identity.type)
  );
}

export function lightingFixtureChannelLabels(
  identity: FixturePatchIdentity,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const mode = fixtureMode(identity, catalog);
  if (mode) return mode.channels.map((channel) => channel.label);
  const count = lightingFixtureChannelCount(identity, catalog);
  return Array.from({ length: count }, (_, index) => `Ch${index + 1}`);
}

export function lightingFixtureMaxStartAddress(
  identity: FixturePatchIdentity,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const count = lightingFixtureChannelCount(identity, catalog);
  return count <= 0 ? 0 : 512 - count + 1;
}

export function lightingFixturePatchSummary(
  dmxStartAddress: number,
  identity: FixturePatchIdentity,
  universe = 1,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const channelCount = lightingFixtureChannelCount(identity, catalog);
  if (dmxStartAddress < 1) {
    return `U${universe} · unpatched (${channelCount} ch needed)`;
  }
  return `U${universe} · ${dmxStartAddress}-${dmxStartAddress + channelCount - 1} (${channelCount} ch)`;
}

export function lightingFixtureModeLabel(
  identity: FixturePatchIdentity,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const mode = fixtureMode(identity, catalog);
  return mode
    ? `${mode.channelCount} ch · ${mode.displayName}`
    : `${lightingFixtureChannelCount(identity, catalog)} ch mode`;
}

export function lightingPatchBarSegments(value: number) {
  return Math.max(0, Math.min(8, Math.round((Math.max(0, Math.min(255, value)) / 255) * 8)));
}

export function findNextLightingFixtureStartAddress(
  fixtures: Array<
    Pick<LightingFixtureSnapshot, "definitionId" | "modeId" | "type" | "kind" | "universe" | "dmxStartAddress">
  >,
  identity: FixturePatchIdentity,
  universe = 1,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const channelCount = lightingFixtureChannelCount(identity, catalog);
  const maxStartAddress = lightingFixtureMaxStartAddress(identity, catalog);
  if (channelCount <= 0) return 0;

  for (let startAddress = 1; startAddress <= maxStartAddress; startAddress += 1) {
    const endAddress = startAddress + channelCount - 1;
    const overlaps = fixtures.some((fixture) => {
      if ((fixture.universe ?? 1) !== universe) return false;
      const existingStart = fixture.dmxStartAddress;
      const existingCount = lightingFixtureChannelCount(fixture, catalog);
      if (existingCount <= 0) return false;
      const existingEnd = existingStart + existingCount - 1;
      return startAddress <= existingEnd && endAddress >= existingStart;
    });
    if (!overlaps) {
      return startAddress;
    }
  }

  return maxStartAddress;
}

export function lightingPatchRangeOverlaps(
  fixtures: Array<
    Pick<LightingFixtureSnapshot, "definitionId" | "modeId" | "type" | "kind" | "universe" | "dmxStartAddress">
  >,
  startAddress: number,
  channelCount: number,
  universe = 1,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  if (channelCount <= 0) return false;
  const endAddress = startAddress + channelCount - 1;
  return fixtures.some((fixture) => {
    if ((fixture.universe ?? 1) !== universe) return false;
    const existingStart = fixture.dmxStartAddress;
    const existingCount = lightingFixtureChannelCount(fixture, catalog);
    if (existingCount <= 0) return false;
    const existingEnd = existingStart + existingCount - 1;
    return startAddress <= existingEnd && endAddress >= existingStart;
  });
}

export function buildLightingPatchOverlapMap(
  fixtures: Array<LightingFixtureSnapshot>,
  catalog?: LightingFixtureCatalogSnapshot | null
) {
  const overlaps = new Map<
    string,
    {
      conflictingFixtureNames: string[];
      suggestedEndAddress: number | null;
      suggestedStartAddress: number | null;
    }
  >();

  fixtures.forEach((fixture) => {
    const channelCount = lightingFixtureChannelCount(fixture, catalog);
    if (channelCount <= 0) return;
    const fixtureStart = fixture.dmxStartAddress;
    const fixtureEnd = fixtureStart + channelCount - 1;
    const conflictingFixtures = fixtures.filter((candidate) => {
      if (candidate.id === fixture.id) {
        return false;
      }
      if (candidate.universe !== fixture.universe) {
        return false;
      }

      const candidateStart = candidate.dmxStartAddress;
      const candidateCount = lightingFixtureChannelCount(candidate, catalog);
      if (candidateCount <= 0) return false;
      const candidateEnd = candidateStart + candidateCount - 1;
      return fixtureStart <= candidateEnd && fixtureEnd >= candidateStart;
    });

    if (conflictingFixtures.length === 0) {
      return;
    }

    const fixturesExcludingCurrent = fixtures.filter((candidate) => candidate.id !== fixture.id);
    const suggestedStartAddress = findNextLightingFixtureStartAddress(
      fixturesExcludingCurrent,
      fixture,
      fixture.universe,
      catalog
    );
    const safeSuggestedStartAddress = lightingPatchRangeOverlaps(
      fixturesExcludingCurrent,
      suggestedStartAddress,
      channelCount,
      fixture.universe,
      catalog
    )
      ? null
      : suggestedStartAddress;

    overlaps.set(fixture.id, {
      conflictingFixtureNames: conflictingFixtures.map((candidate) => candidate.name),
      suggestedEndAddress: safeSuggestedStartAddress === null ? null : safeSuggestedStartAddress + channelCount - 1,
      suggestedStartAddress: safeSuggestedStartAddress,
    });
  });

  return overlaps;
}
