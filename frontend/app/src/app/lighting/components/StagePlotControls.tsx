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
      <button type="button" className={styles.button} onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
        −
      </button>
      <span className={styles.zoomLabel} aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className={styles.button} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
        +
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={onReset}
        aria-label="Reset view"
        title="Reset view (double-click plot)"
      >
        ⤾
      </button>
    </div>
  );
}
