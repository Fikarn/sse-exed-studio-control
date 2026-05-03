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
  universe: number;
  channel: number;
  value: number;
  assigned: boolean;
  fixtureName?: string;
  channelLabel?: string;
}

function buildCells(snapshot: LightingDmxMonitorSnapshot | null, universe: number): CellData[] {
  const byChannel = new Map<string, { value: number; lightName: string; label: string }>();
  const universes = new Set<number>([universe]);
  for (const entry of snapshot?.channels ?? []) {
    universes.add(entry.universe);
    byChannel.set(`${entry.universe}:${entry.channel}`, {
      value: entry.value,
      lightName: entry.lightName,
      label: entry.label,
    });
  }
  const cells: CellData[] = [];
  for (const currentUniverse of Array.from(universes).sort((left, right) => left - right)) {
    for (let channel = 1; channel <= TOTAL_CHANNELS; channel += 1) {
      const entry = byChannel.get(`${currentUniverse}:${channel}`);
      if (entry) {
        cells.push({
          universe: currentUniverse,
          channel,
          value: entry.value,
          assigned: true,
          fixtureName: entry.lightName,
          channelLabel: entry.label,
        });
      } else {
        cells.push({ universe: currentUniverse, channel, value: 0, assigned: false });
      }
    }
  }
  return cells;
}

function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0").toUpperCase();
}

export function DMXMonitorDialog({ universe, snapshot, reachable, onClose }: DMXMonitorDialogProps) {
  const cells = useMemo(() => buildCells(snapshot, universe), [snapshot, universe]);
  const universes = useMemo(() => Array.from(new Set(cells.map((cell) => cell.universe))), [cells]);
  const assignedCount = cells.filter((cell) => cell.assigned).length;
  const universeLabel = universes.map((entry) => `U${entry}`).join("/");

  return (
    <Dialog
      title={`DMX universe ${universeLabel}`}
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
        {universes.map((currentUniverse) => {
          const universeCells = cells.filter((cell) => cell.universe === currentUniverse);
          return (
            <div
              key={currentUniverse}
              className={styles.grid}
              role="grid"
              aria-label={`DMX universe U${currentUniverse} channels`}
            >
              {universes.length > 1 ? <div className={styles.legendKey}>U{currentUniverse}</div> : null}
              {Array.from({ length: Math.ceil(universeCells.length / 16) }, (_, rowIdx) => (
                <div key={rowIdx} role="row" className={styles.row}>
                  {universeCells.slice(rowIdx * 16, (rowIdx + 1) * 16).map((cell) => {
                    const channelPrefix =
                      universes.length === 1 ? `Ch ${cell.channel}` : `U${cell.universe} Ch ${cell.channel}`;
                    const tooltip = cell.assigned
                      ? `${channelPrefix} · ${cell.fixtureName} · ${cell.channelLabel}`
                      : `${channelPrefix} · unassigned`;
                    const className = cell.assigned ? `${styles.cell} ${styles.cellAssigned}` : styles.cell;
                    const fillPercent = Math.max(0, Math.min(100, (cell.value / 255) * 100));
                    return (
                      <div
                        key={`${cell.universe}:${cell.channel}`}
                        className={className}
                        role="gridcell"
                        title={tooltip}
                      >
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
              ))}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
