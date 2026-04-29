import { useMemo } from "react";

import { Button, Dialog } from "@sse/design-system";
import type { LightingDmxMonitorSnapshot } from "@sse/engine-client";

import styles from "./DMXMonitorDialog.module.css";

const TOTAL_CHANNELS = 512;

export interface DMXMonitorDialogProps {
  universe: number;
  snapshot: LightingDmxMonitorSnapshot | null;
  reachable: boolean;
  onClose: () => void;
}

interface CellData {
  channel: number;
  value: number;
  assigned: boolean;
  fixtureName?: string;
  channelLabel?: string;
}

function buildCells(snapshot: LightingDmxMonitorSnapshot | null): CellData[] {
  const byChannel = new Map<number, { value: number; lightName: string; label: string }>();
  for (const entry of snapshot?.channels ?? []) {
    byChannel.set(entry.channel, {
      value: entry.value,
      lightName: entry.lightName,
      label: entry.label,
    });
  }
  const cells: CellData[] = [];
  for (let channel = 1; channel <= TOTAL_CHANNELS; channel += 1) {
    const entry = byChannel.get(channel);
    if (entry) {
      cells.push({
        channel,
        value: entry.value,
        assigned: true,
        fixtureName: entry.lightName,
        channelLabel: entry.label,
      });
    } else {
      cells.push({ channel, value: 0, assigned: false });
    }
  }
  return cells;
}

function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

export function DMXMonitorDialog({ universe, snapshot, reachable, onClose }: DMXMonitorDialogProps) {
  const cells = useMemo(() => buildCells(snapshot), [snapshot]);
  const assignedCount = cells.filter((cell) => cell.assigned).length;

  return (
    <Dialog
      title={`DMX universe U${universe}`}
      body={
        reachable
          ? `${assignedCount} of ${TOTAL_CHANNELS} channels are patched to fixtures. Hover any cell for the fixture name and channel label.`
          : `Bridge unreachable. Showing the last-known state of ${assignedCount} patched channels.`
      }
      onClose={onClose}
      actions={
        <Button onClick={onClose} variant="ghost" size="compact">
          Close
        </Button>
      }
    >
      <div className={styles.shell}>
        <div className={styles.legend}>
          <span className={styles.legendKey}>
            <span className={`${styles.legendSwatch} ${styles.legendSwatchAssigned}`} aria-hidden="true" />
            Patched to a fixture
          </span>
          <span className={styles.legendKey}>
            <span className={styles.legendSwatch} aria-hidden="true" />
            Unassigned
          </span>
        </div>
        <div className={styles.grid} role="grid" aria-label={`DMX universe U${universe} channels`}>
          {cells.map((cell) => {
            const tooltip = cell.assigned
              ? `Ch ${cell.channel} · ${cell.fixtureName} · ${cell.channelLabel}`
              : `Ch ${cell.channel} · unassigned`;
            const className = cell.assigned ? `${styles.cell} ${styles.cellAssigned}` : styles.cell;
            const fillPercent = Math.max(0, Math.min(100, (cell.value / 255) * 100));
            return (
              <div key={cell.channel} className={className} role="gridcell" title={tooltip}>
                <span className={styles.cellHeader}>
                  <span>{String(cell.channel).padStart(3, "0")}</span>
                </span>
                <span className={styles.cellValue}>{toHex(cell.value)}</span>
                <span className={styles.cellBar}>
                  <span className={styles.cellBarFill} style={{ width: `${fillPercent}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
