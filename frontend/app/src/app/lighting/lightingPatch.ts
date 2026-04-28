// DMX patching helpers. Channel counts depend on fixture type; the rest of
// the helpers compose channel counts to detect overlapping fixtures and
// suggest replacement addresses.

export function lightingFixtureChannelCount(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinimat":
      return 4;
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return 8;
    default:
      return 2;
  }
}

export function lightingFixtureChannelLabels(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "astra":
    case "astra bi-color":
    case "astra-bicolor":
    case "apollo bridge":
      return ["Dimmer", "CCT"];
    case "infinimat":
      return ["Dimmer", "CCT", "±G/M", "Strobe"];
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return ["Dimmer", "CCT", "Mix", "Red", "Green", "Blue", "FX", "Speed"];
    default:
      return [];
  }
}

export function lightingFixtureMaxStartAddress(fixtureType: string) {
  return 512 - lightingFixtureChannelCount(fixtureType) + 1;
}

export function lightingFixturePatchSummary(dmxStartAddress: number, fixtureType: string, universe = 1) {
  const channelCount = lightingFixtureChannelCount(fixtureType);
  if (dmxStartAddress < 1) {
    return `u${universe} · unpatched (${channelCount} ch needed)`;
  }
  return `u${universe} · ${dmxStartAddress}-${dmxStartAddress + channelCount - 1} (${channelCount} ch)`;
}

export function lightingFixtureModeLabel(fixtureType: string) {
  return `${lightingFixtureChannelCount(fixtureType)} ch mode`;
}

export function lightingPatchBarSegments(value: number) {
  return Math.max(0, Math.min(8, Math.round((Math.max(0, Math.min(255, value)) / 255) * 8)));
}

export function findNextLightingFixtureStartAddress(
  fixtures: Array<{ dmxStartAddress: number; type: string }>,
  fixtureType: string
) {
  const channelCount = lightingFixtureChannelCount(fixtureType);
  const maxStartAddress = lightingFixtureMaxStartAddress(fixtureType);

  for (let startAddress = 1; startAddress <= maxStartAddress; startAddress += 1) {
    const endAddress = startAddress + channelCount - 1;
    const overlaps = fixtures.some((fixture) => {
      const existingStart = fixture.dmxStartAddress;
      const existingEnd = existingStart + lightingFixtureChannelCount(fixture.type) - 1;
      return startAddress <= existingEnd && endAddress >= existingStart;
    });
    if (!overlaps) {
      return startAddress;
    }
  }

  return maxStartAddress;
}

export function lightingPatchRangeOverlaps(
  fixtures: Array<{ dmxStartAddress: number; type: string }>,
  startAddress: number,
  channelCount: number
) {
  const endAddress = startAddress + channelCount - 1;
  return fixtures.some((fixture) => {
    const existingStart = fixture.dmxStartAddress;
    const existingEnd = existingStart + lightingFixtureChannelCount(fixture.type) - 1;
    return startAddress <= existingEnd && endAddress >= existingStart;
  });
}

export function buildLightingPatchOverlapMap(
  fixtures: Array<{ dmxStartAddress: number; id: string; name: string; type: string }>
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
    const channelCount = lightingFixtureChannelCount(fixture.type);
    const fixtureStart = fixture.dmxStartAddress;
    const fixtureEnd = fixtureStart + channelCount - 1;
    const conflictingFixtures = fixtures.filter((candidate) => {
      if (candidate.id === fixture.id) {
        return false;
      }

      const candidateStart = candidate.dmxStartAddress;
      const candidateEnd = candidateStart + lightingFixtureChannelCount(candidate.type) - 1;
      return fixtureStart <= candidateEnd && fixtureEnd >= candidateStart;
    });

    if (conflictingFixtures.length === 0) {
      return;
    }

    const fixturesExcludingCurrent = fixtures.filter((candidate) => candidate.id !== fixture.id);
    const suggestedStartAddress = findNextLightingFixtureStartAddress(fixturesExcludingCurrent, fixture.type);
    const safeSuggestedStartAddress = lightingPatchRangeOverlaps(
      fixturesExcludingCurrent,
      suggestedStartAddress,
      channelCount
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

