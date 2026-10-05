import { type ChangeEvent, type KeyboardEvent, useEffect, useState } from "react";

import { Key, PlateHead, Readouts, Section, Tooltip } from "@sse/design-system";
import type { LightingFixtureCatalogSnapshot, LightingFixtureSnapshot } from "@sse/engine-client";

import type { LightingDmxChannelEntry } from "../../shellData";
import { formatLightingBeamAngleValue, formatLightingRigHeight } from "../lightingHelpers";
import {
  lightingFixtureChannelCount,
  lightingFixtureMaxStartAddress,
  lightingFixtureModeLabel,
  lightingFixturePatchSummary,
} from "../lightingPatch";

import { DMXPeek } from "./DMXPeek";
import { IdentifyBurstButton } from "./IdentifyBurstButton";
import styles from "./LightingInspector.module.css";

export interface InspectorPatchProps {
  fixture: LightingFixtureSnapshot | null;
  universe: number;
  catalog?: LightingFixtureCatalogSnapshot | null;
  dmxChannels: readonly LightingDmxChannelEntry[];
  dmxStale: boolean;
  bridgeReachable?: boolean;
  patchOverlap: {
    conflictingFixtureNames: string[];
    suggestedStartAddress: number | null;
    suggestedEndAddress: number | null;
  } | null;
  onPatchCommit: (fixtureId: string, nextStartAddress: number) => void;
  onIdentifyBurst: (fixtureId: string, fixtureName: string) => void;
  busy?: boolean;
}

// The visual overhaul's Lighting page (2026-10-04): a fixture while patching.
// Its title plate and Identify; where it sits in the universe; its start
// address, typed; a collision, with the address that fixes it; and what its
// channels are sending now.
export function InspectorPatch({
  fixture,
  universe,
  catalog = null,
  dmxChannels,
  dmxStale,
  bridgeReachable = true,
  patchOverlap,
  onPatchCommit,
  onIdentifyBurst,
  busy = false,
}: InspectorPatchProps) {
  const fixtureDraftKey = fixture?.id ?? "";
  const fixtureDraftAddress = fixture ? String(fixture.dmxStartAddress) : "";
  const [draft, setDraft] = useState(fixtureDraftAddress);

  useEffect(() => {
    setDraft(fixtureDraftAddress);
  }, [fixtureDraftAddress, fixtureDraftKey]);

  // The visual overhaul's polish (2026-10-05): the helper sentence is the
  // title's tooltip (DESIGN.md §9); until then it was the sub-line.
  if (!fixture) {
    return (
      <PlateHead
        title={
          <Tooltip
            content="Choose a fixture on the plot to set its DMX address. Leave Patch from the latch under the state display."
            placement="left"
          >
            <span>Patch</span>
          </Tooltip>
        }
        testId="lighting-plate-head"
      />
    );
  }

  const maxStartAddress = lightingFixtureMaxStartAddress(fixture, catalog);
  const channelCount = lightingFixtureChannelCount(fixture, catalog);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.currentTarget.value);
  };

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setDraft(String(fixture.dmxStartAddress));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setDraft(String(fixture.dmxStartAddress));
      return;
    }
    const rounded = Math.max(1, Math.min(maxStartAddress, Math.round(value)));
    if (rounded !== fixture.dmxStartAddress) {
      onPatchCommit(fixture.id, rounded);
    } else {
      setDraft(String(fixture.dmxStartAddress));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    }
    if (event.key === "Escape") {
      setDraft(String(fixture.dmxStartAddress));
    }
  };

  const range =
    fixture.dmxStartAddress < 1
      ? "Unpatched"
      : `${String(fixture.dmxStartAddress).padStart(3, "0")}–${String(fixture.dmxStartAddress + channelCount - 1).padStart(3, "0")}`;

  return (
    <>
      <PlateHead
        title={fixture.name}
        sub={`${fixture.type} · ${lightingFixtureModeLabel(fixture, catalog)}`}
        action={
          <IdentifyBurstButton
            fixtureId={fixture.id}
            fixtureName={fixture.name}
            onTrigger={onIdentifyBurst}
            disabled={busy}
            bridgeReachable={bridgeReachable}
          />
        }
        testId="lighting-plate-head"
      />

      <Readouts
        rows={[
          { id: "universe", label: "Universe", value: `U${fixture.universe ?? universe}` },
          { id: "range", label: "Range", value: range },
          { id: "height", label: "Rig height", value: formatLightingRigHeight(fixture.rigZ ?? undefined) },
          {
            id: "beam",
            label: "Beam",
            value: formatLightingBeamAngleValue(fixture.type, fixture.beamAngleDegrees ?? undefined),
          },
        ]}
      />

      <Section
        title={
          <Tooltip
            content={`${lightingFixturePatchSummary(fixture.dmxStartAddress, fixture, fixture.universe ?? universe, catalog)} · the highest start is ${maxStartAddress}`}
          >
            <span>Start address</span>
          </Tooltip>
        }
      >
        <div className={styles.patchEditor}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Start channel</span>
            <input
              aria-label="Fixture patch start channel"
              className={styles.fieldInput}
              disabled={busy}
              inputMode="numeric"
              max={maxStartAddress}
              min={1}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              type="number"
              value={draft}
            />
          </label>
          <Key
            size="large"
            disabled={busy || draft.trim() === String(fixture.dmxStartAddress)}
            onClick={() => commit(draft)}
          >
            Apply
          </Key>
        </div>
      </Section>

      {patchOverlap ? (
        <Section title="Patch collision" detail={patchOverlap.conflictingFixtureNames.join(", ")}>
          {patchOverlap.suggestedStartAddress !== null && patchOverlap.suggestedEndAddress !== null ? (
            <div className={styles.collisionRow}>
              <Tooltip
                content={`Free from ${String(patchOverlap.suggestedStartAddress).padStart(3, "0")} to ${String(
                  patchOverlap.suggestedEndAddress
                ).padStart(3, "0")}.`}
              >
                <Key
                  size="large"
                  disabled={busy}
                  onClick={() => onPatchCommit(fixture.id, patchOverlap.suggestedStartAddress!)}
                >
                  Auto-fix to {String(patchOverlap.suggestedStartAddress).padStart(3, "0")}
                </Key>
              </Tooltip>
            </div>
          ) : (
            <p className={styles.attentionLine}>
              No free start channel is left in this universe. Free one by moving another fixture off its range.
            </p>
          )}
        </Section>
      ) : null}

      <Section title="DMX peek" detail="the levels the hardware link sends">
        <DMXPeek
          fixtureType={fixture.type}
          fixture={fixture}
          catalog={catalog}
          fixtureDmxStartAddress={fixture.dmxStartAddress}
          channels={dmxChannels}
          stale={dmxStale}
        />
      </Section>
    </>
  );
}
