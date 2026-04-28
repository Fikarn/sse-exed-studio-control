import { type ChangeEvent } from "react";
import { Power } from "lucide-react";

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
  const handleSlider = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      onGrandMasterChange(value);
    }
  };

  const anyOn = fixtureOnCount > 0;
  const sliderDisabled = !enabled || !bridgeReachable;
  const cardClass = anyOn ? `${styles.master} ${styles.masterOn}` : styles.master;
  const resolvedEyebrow = eyebrow ?? `Master · ${fixtureOnCount} / ${fixtureTotal} emitting`;
  const stateName = !bridgeReachable ? "Lighting offline" : anyOn ? "Lighting on" : "Lighting paused";

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
            aria-label={anyOn ? "Pause all lighting fixtures" : "Resume all lighting fixtures"}
            disabled={!bridgeReachable}
          >
            <span className={styles.masterTogglePin} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.masterFader}>
        <span className={styles.masterFaderLabel}>Grand master</span>
        <input
          aria-label="Grand master intensity"
          className={styles.masterSlider}
          disabled={sliderDisabled}
          max={100}
          min={0}
          onChange={handleSlider}
          type="range"
          value={grandMaster}
        />
        <span className={styles.masterFaderValue}>{Math.round(grandMaster)} %</span>
      </div>

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
