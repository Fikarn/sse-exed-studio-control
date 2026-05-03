import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import type { LightingDmxChannelEntry } from "../../shellData";
import { lightingFixtureChannelCount, lightingFixtureChannelLabels } from "../lightingPatch";

import { DMXChannel } from "./DMXChannel";
import styles from "./LightingInspector.module.css";

export interface DMXPeekProps {
  fixtureType: string;
  fixture?: LightingFixtureSnapshot;
  catalog?: LightingFixtureCatalogSnapshot | null;
  fixtureDmxStartAddress: number;
  channels: readonly LightingDmxChannelEntry[];
  stale?: boolean;
}

export function DMXPeek({
  fixtureType,
  fixture,
  catalog = null,
  fixtureDmxStartAddress,
  channels,
  stale = false,
}: DMXPeekProps) {
  const identity = fixture ?? fixtureType;
  const channelCount = lightingFixtureChannelCount(identity, catalog);
  const labels = lightingFixtureChannelLabels(identity, catalog);
  const universe = fixture?.universe ?? 1;
  const channelByNumber = new Map(
    channels.filter((channel) => channel.universe === universe).map((channel) => [channel.channel, channel])
  );

  const rows = Array.from({ length: channelCount }, (_, offset) => {
    const channelNumber = fixtureDmxStartAddress + offset;
    const channel = channelByNumber.get(channelNumber);
    return {
      channel: channelNumber,
      label: channel?.label ?? labels[offset] ?? `Ch${offset + 1}`,
      value: channel?.value ?? 0,
    };
  });

  return (
    <div
      className={styles.peek}
      data-stale={stale}
      role="list"
      aria-label={`DMX peek for fixture starting at ${fixtureDmxStartAddress}`}
    >
      {rows.map((row) => (
        <DMXChannel key={`peek:${row.channel}`} channel={row.channel} label={row.label} value={row.value} />
      ))}
    </div>
  );
}
