// 2026-10-01 (the owner's decision, after the studio walk): the Console's
// snapshots are TotalMix's own. A load asks TotalMix to load the slot, then
// reads the desk back as Sync does, and the reply is what the Console reports:
// the slot and how many values the read-back brought, or, when the read-back
// failed after the load went out, the hardware link's own sentence. 48 V does
// not switch with a TotalMix snapshot, so the report has nothing to arm.

export interface AudioLoadReport {
  slot: number;
  /** TotalMix's name for the slot, or `Slot N` when it saved none. */
  name: string;
  /** False when the load went out and the read-back failed (`consoleStateConfidence` "unknown"). */
  readBack: boolean;
  /** One operator sentence under the title. */
  line: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function parseAudioLoadReport(result: unknown): AudioLoadReport | null {
  const record = asRecord(result);
  if (!record || record.loaded !== true || typeof record.slot !== "number") return null;
  const slot = record.slot;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : `Slot ${slot}`;
  const readBack = record.consoleStateConfidence !== "unknown";
  const summary = typeof record.summary === "string" ? record.summary : "";
  return {
    slot,
    name,
    readBack,
    // Nothing read back (the read-back failed, or the simulated console sent
    // nothing): the hardware link's own sentence says what happened.
    line:
      readBack && asCount(record.pulledValues) > 0
        ? `${asCount(record.pulledValues)} values read back from the desk.`
        : summary || `${asCount(record.pulledValues)} values read back from the desk.`,
  };
}
