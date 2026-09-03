// 2026-09 audit remediation, Slice 4: a recall pushes the snapshot to the
// desk and reports what the console confirmed. 48V is never pushed; each
// difference is listed so the operator can arm it deliberately.

export interface AudioRecallPhantomDifference {
  channelId: string;
  channelName: string;
  /** What the console has (kept in app state). */
  current: boolean;
  /** What the snapshot wanted. */
  target: boolean;
}

export interface AudioRecallReport {
  snapshotId: string;
  snapshotName: string;
  pushed: number;
  confirmed: number;
  adjusted: number;
  unconfirmed: number;
  consoleStateConfidence: string;
  phantomDifferences: AudioRecallPhantomDifference[];
  /** One operator sentence: counts, then the 48V differences. */
  summaryLine: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function parseAudioRecallReport(result: unknown): AudioRecallReport | null {
  const record = asRecord(result);
  if (!record || record.recalled !== true) return null;
  const snapshotId = typeof record.snapshotId === "string" ? record.snapshotId : "";
  const snapshotName = typeof record.snapshotName === "string" ? record.snapshotName : "snapshot";
  const pushed = asCount(record.pushed);
  const confirmed = asCount(record.confirmed);
  const adjusted = asCount(record.adjusted);
  const unconfirmed = asCount(record.unconfirmed);
  const consoleStateConfidence =
    typeof record.consoleStateConfidence === "string" ? record.consoleStateConfidence : "unknown";
  const phantomDifferences: AudioRecallPhantomDifference[] = Array.isArray(record.phantomDifferences)
    ? record.phantomDifferences
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => ({
          channelId: typeof entry.channelId === "string" ? entry.channelId : "",
          channelName: typeof entry.channelName === "string" ? entry.channelName : "channel",
          current: entry.current === true,
          target: entry.target === true,
        }))
        .filter((entry) => entry.channelId.length > 0)
    : [];

  const parts: string[] = [];
  if (pushed === 0) {
    parts.push("nothing pushed to the console");
  } else {
    parts.push(`${pushed} values pushed, ${confirmed} confirmed`);
    if (adjusted > 0) parts.push(`${adjusted} adjusted by the console`);
    if (unconfirmed > 0) parts.push(`${unconfirmed} unconfirmed`);
  }
  let summaryLine = `${parts.join(", ")}.`;
  if (phantomDifferences.length > 0) {
    const names = phantomDifferences
      .map(
        (entry) =>
          `${entry.channelName} (snapshot ${entry.target ? "on" : "off"}, console ${entry.current ? "on" : "off"})`
      )
      .join(", ");
    summaryLine += ` 48V differs on ${names}.`;
  }

  return {
    snapshotId,
    snapshotName,
    pushed,
    confirmed,
    adjusted,
    unconfirmed,
    consoleStateConfidence,
    phantomDifferences,
    summaryLine,
  };
}
