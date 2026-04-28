import { Tooltip } from "@sse/design-system";

import styles from "./StagePlotControls.module.css";

export interface StagePlotControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function StagePlotControls({ zoom, onZoomIn, onZoomOut, onReset }: StagePlotControlsProps) {
  return (
    <div className={styles.controls} role="toolbar" aria-label="Stage plot view">
      <Tooltip content="Zoom out · scroll wheel works too" placement="top">
        <button type="button" className={styles.button} onClick={onZoomOut} aria-label="Zoom out">
          −
        </button>
      </Tooltip>
      <span className={styles.zoomLabel} aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <Tooltip content="Zoom in · scroll wheel works too" placement="top">
        <button type="button" className={styles.button} onClick={onZoomIn} aria-label="Zoom in">
          +
        </button>
      </Tooltip>
      <Tooltip content="Reset view · double-click the plot" placement="top">
        <button type="button" className={styles.button} onClick={onReset} aria-label="Reset view">
          ⤾
        </button>
      </Tooltip>
    </div>
  );
}
