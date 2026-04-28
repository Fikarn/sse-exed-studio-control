import { type ChangeEvent } from "react";
import { Power } from "lucide-react";

import styles from "./LightingRail.module.css";

export interface MasterCardProps {
  grandMaster: number;
  enabled: boolean;
  bridgeReachable: boolean;
  onGrandMasterChange: (value: number) => void;
  onEmergencyCut: () => void;
  eyebrow?: string;
}

export function MasterCard({
  grandMaster,
  enabled,
  bridgeReachable,
  onGrandMasterChange,
  onEmergencyCut,
  eyebrow,
}: MasterCardProps) {
  const handleSlider = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      onGrandMasterChange(value);
    }
  };

  const sliderDisabled = !enabled || !bridgeReachable;

  return (
    <section className={styles.master} aria-label="Lighting master controls">
      {eyebrow ? <span className={styles.masterEyebrow}>{eyebrow}</span> : null}
      <header className={styles.masterHeader}>
        <span className={styles.masterLabel}>Master</span>
        <span className={styles.masterValue}>{Math.round(grandMaster)} %</span>
      </header>
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
      <button
        type="button"
        className={styles.emergencyCut}
        onClick={onEmergencyCut}
        aria-label="Emergency cut all fixtures"
      >
        <Power aria-hidden="true" size={14} strokeWidth={2} />
        <span>Cut all</span>
      </button>
    </section>
  );
}
