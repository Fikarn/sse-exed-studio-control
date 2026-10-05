import { LampWord, type LampTone } from "@sse/design-system";

import { asRecord, healthCheckTone, type SnapshotRecord } from "../shellData";
import styles from "./HardwareChecks.module.css";

// The visual overhaul's polish (2026-10-05): the hardware's three checks, as
// the plate of every screen before ready prints them (DESIGN §2: the
// hardware's diagnostics on the plate). The start-up plate stood empty and
// the recovery plate drew them itself; one list now, so the two screens read
// as one instrument. Slice 8 (system §9): name the hardware.

const CHECKS = [
  { key: "controlSurface", label: "The deck" },
  { key: "lighting", label: "The bridge" },
  { key: "audio", label: "The desk" },
] as const;

/** A check of the hardware, as the plate prints it: one word with its lamp. */
function checkWord(status: unknown, failed: boolean): { word: string; tone: LampTone } {
  // Nothing was read: a start that failed reads no health at all (the
  // handshake fails before it), so the three say so, not doubt; a start still
  // under way has not asked yet.
  if (status === undefined) return failed ? { word: "not read", tone: "off" } : { word: "pending", tone: "off" };
  const tone = healthCheckTone(status);
  if (tone === "ok") return { word: "ready", tone: "ok" };
  if (tone === "error") return { word: "failed", tone: "error" };
  if (tone === "attention") return { word: "needs attention", tone: "attention" };
  return { word: "pending", tone: "off" };
}

export interface HardwareChecksProps {
  /** The hardware link's health snapshot; none before it reports. */
  healthSnapshot?: SnapshotRecord | null;
  /** The start failed: a check never read says `not read`, not `pending`. */
  failed: boolean;
  testId?: string;
}

export function HardwareChecks({ healthSnapshot, failed, testId }: HardwareChecksProps) {
  const checks = asRecord(healthSnapshot?.checks);
  return (
    <ul className={styles.checks} data-testid={testId}>
      {CHECKS.map(({ key, label }) => {
        const check = asRecord(checks?.[key]);
        const { word, tone } = checkWord(check?.status, failed);
        // What the hardware said, only when it said something: a check never
        // read shows its name and its word alone (it read "The deck reported
        // nothing at startup." under each NOT READ, three times).
        const detail = check?.summary ? String(check.summary) : null;
        return (
          <li key={key} className={styles.check}>
            <span className={styles.checkTitle}>{label}</span>
            <LampWord tone={tone} className={styles.checkWord}>
              {word}
            </LampWord>
            {detail ? <span className={styles.hint}>{detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
