import { Power } from "lucide-react";

import { ScrubSlider } from "@sse/design-system";

import styles from "./LightingRail.module.css";

export interface MasterCardProps {
  grandMaster: number;
  enabled: boolean;
  bridgeReachable: boolean;
  /** Number of fixtures currently `on` (used by the prototype's eyebrow). */
  fixtureOnCount: number;
  fixtureTotal: number;
  onGrandMasterChange: (value: number) => void;
  onEmergencyCut: () => void;
  /** Optional eyebrow override (e.g. "Master · paused · patch mode"). */
  eyebrow?: string;
  /** Toggle the rig live/paused state — clicking the prototype's pill toggle. */
  onToggleAllPower?: (on: boolean) => void;
}

export function MasterCard({
  grandMaster,
  enabled,
  bridgeReachable,
  fixtureOnCount,
  fixtureTotal,
  onGrandMasterChange,
  onEmergencyCut,
  eyebrow,
  onToggleAllPower,
}: MasterCardProps) {
  const anyOn = fixtureOnCount > 0;
  const sliderDisabled = !enabled || !bridgeReachable;
  const cardClass = anyOn ? `${styles.master} ${styles.masterOn}` : styles.master;
  const resolvedEyebrow = eyebrow ?? `Master · ${fixtureOnCount} / ${fixtureTotal} on`;
  const stateName = !bridgeReachable
    ? "Lighting offline"
    : anyOn
      ? "Lighting on"
      : fixtureTotal === 0
        ? "No fixtures"
        : "All fixtures off";

  return (
    <section className={cardClass} aria-label="Lighting master controls">
      <div className={styles.masterRow}>
        <div className={styles.masterInfo}>
          <span className={styles.masterEyebrow}>{resolvedEyebrow}</span>
          <span className={styles.masterName}>{stateName}</span>
        </div>
        {onToggleAllPower ? (
          <button
            type="button"
            className={`${styles.masterToggle} ${anyOn ? styles.masterToggleOn : ""}`}
            onClick={() => onToggleAllPower(!anyOn)}
            aria-pressed={anyOn}
            aria-label={anyOn ? "Pause lighting" : "Resume lighting"}
            disabled={!bridgeReachable}
          >
            <span className={styles.masterTogglePin} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.masterFader}>
        <span className={styles.masterFaderLabel}>Grand master</span>
        <ScrubSlider
          ariaLabel="Grand master intensity"
          min={0}
          max={100}
          step={1}
          value={grandMaster}
          onChange={onGrandMasterChange}
          resetValue={100}
          disabled={sliderDisabled}
          formatValue={(v) => `${Math.round(v)} %`}
        />
      </div>

      {/* "Cut all" naming retained per audit-fix-plan #43 + Waves 19-22 plan locked decision. */}
      <button
        type="button"
        className={styles.emergencyCut}
        onClick={onEmergencyCut}
        aria-label="Emergency cut all fixtures"
        disabled={!bridgeReachable}
      >
        <Power aria-hidden="true" size={14} strokeWidth={2} />
        <span>Cut all</span>
      </button>
    </section>
  );
}
