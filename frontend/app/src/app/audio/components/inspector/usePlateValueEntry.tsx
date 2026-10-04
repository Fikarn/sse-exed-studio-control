import { useState, type ReactNode } from "react";
import { NumberEntryDialog } from "@sse/design-system";

// The plate's typed entry (visual overhaul, the Console): a value set by number
// from a knob inside a popover. The knob's own dialog would open under the
// popover and close it, so the section closes the popover and asks here; the
// words, ranges and reset are the knob's.

export interface PlateValueEntry {
  title: string;
  fieldLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  resetValue?: number;
  resetLabel?: string;
  onConfirm: (value: number) => void;
}

export function usePlateValueEntry(): { ask: (entry: PlateValueEntry) => void; dialog: ReactNode } {
  const [entry, setEntry] = useState<PlateValueEntry | null>(null);
  const dialog = entry ? (
    <NumberEntryDialog
      fieldLabel={entry.fieldLabel}
      initialValue={entry.value}
      max={entry.max}
      min={entry.min}
      onCancel={() => setEntry(null)}
      onConfirm={(next) => {
        setEntry(null);
        entry.onConfirm(Math.max(entry.min, Math.min(entry.max, next)));
      }}
      resetLabel={entry.resetLabel}
      resetValue={entry.resetValue}
      step={entry.step}
      suffix={entry.suffix}
      title={entry.title}
    />
  ) : null;
  return { ask: setEntry, dialog };
}
