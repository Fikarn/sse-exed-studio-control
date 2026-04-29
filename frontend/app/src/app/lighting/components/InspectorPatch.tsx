import { type ChangeEvent, type KeyboardEvent, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button, InspectorSection } from "@sse/design-system";
import type { LightingFixtureSnapshot } from "@sse/engine-client";

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

export function InspectorPatch({
  fixture,
  universe,
  dmxChannels,
  dmxStale,
  bridgeReachable = true,
  patchOverlap,
  onPatchCommit,
  onIdentifyBurst,
  busy = false,
}: InspectorPatchProps) {
  const [draft, setDraft] = useState(fixture ? String(fixture.dmxStartAddress) : "");

  useEffect(() => {
    setDraft(fixture ? String(fixture.dmxStartAddress) : "");
  }, [fixture?.id, fixture?.dmxStartAddress]);

  if (!fixture) {
    return (
      <InspectorSection title="Patch mode">
        <p className={styles.empty}>
          Select a fixture on the stage plot to edit its DMX address. Press <kbd className={styles.kbd}>P</kbd> to leave
          patch mode.
        </p>
      </InspectorSection>
    );
  }

  const maxStartAddress = lightingFixtureMaxStartAddress(fixture.type);
  const channelCount = lightingFixtureChannelCount(fixture.type);

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

  return (
    <>
      <InspectorSection title="Patch">
        <div className={styles.fixtureHeader}>
          <div>
            <div className={styles.fixtureName}>{fixture.name}</div>
            <div className={styles.fixtureSubline}>
              {fixture.type} · {lightingFixtureModeLabel(fixture.type)}
            </div>
          </div>
          <IdentifyBurstButton
            fixtureId={fixture.id}
            fixtureName={fixture.name}
            onTrigger={onIdentifyBurst}
            disabled={busy}
            bridgeReachable={bridgeReachable}
          />
        </div>

        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Universe</dt>
            <dd className={styles.factValue}>u{universe}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Range</dt>
            <dd className={styles.factValue}>
              {fixture.dmxStartAddress < 1
                ? "Unpatched"
                : `${String(fixture.dmxStartAddress).padStart(3, "0")}–${String(
                    fixture.dmxStartAddress + channelCount - 1
                  ).padStart(3, "0")}`}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Rig height</dt>
            <dd className={styles.factValue}>{formatLightingRigHeight(fixture.rigZ ?? undefined)}</dd>
          </div>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Beam</dt>
            <dd className={styles.factValue}>
              {formatLightingBeamAngleValue(fixture.type, fixture.beamAngleDegrees ?? undefined)}
            </dd>
          </div>
        </dl>
      </InspectorSection>

      <InspectorSection title="Start address">
        <div className={styles.patchEditor}>
          <label className={styles.patchField}>
            <span className={styles.patchFieldLabel}>Start channel</span>
            <input
              aria-label="Fixture patch start channel"
              className={styles.patchInput}
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
          <Button
            onClick={() => commit(draft)}
            loading={busy}
            disabled={draft.trim() === String(fixture.dmxStartAddress)}
            variant="secondary"
            size="compact"
          >
            Apply
          </Button>
        </div>
        <div className={styles.helpText}>
          {lightingFixturePatchSummary(fixture.dmxStartAddress, fixture.type, universe)} · max start {maxStartAddress}
        </div>
      </InspectorSection>

      {patchOverlap ? (
        <InspectorSection title="Patch collision">
          <div className={styles.collisionCard}>
            <div className={styles.collisionHeader}>
              <AlertTriangle aria-hidden="true" size={14} strokeWidth={2} />
              <span>{patchOverlap.conflictingFixtureNames.join(", ")}</span>
            </div>
            {patchOverlap.suggestedStartAddress !== null && patchOverlap.suggestedEndAddress !== null ? (
              <div className={styles.actionRow}>
                <Button
                  onClick={() => onPatchCommit(fixture.id, patchOverlap.suggestedStartAddress!)}
                  disabled={busy}
                  variant="secondary"
                  size="compact"
                >
                  Auto-fix to {String(patchOverlap.suggestedStartAddress).padStart(3, "0")}
                </Button>
                <span className={styles.helpText}>
                  Safe range {String(patchOverlap.suggestedStartAddress).padStart(3, "0")}–
                  {String(patchOverlap.suggestedEndAddress).padStart(3, "0")}
                </span>
              </div>
            ) : (
              <p className={styles.helpText}>No conflict-free start channel is available in this universe.</p>
            )}
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection title="DMX peek">
        <DMXPeek
          fixtureType={fixture.type}
          fixtureDmxStartAddress={fixture.dmxStartAddress}
          channels={dmxChannels}
          stale={dmxStale}
        />
      </InspectorSection>
    </>
  );
}
