import { Footer } from "@sse/design-system";
import type { AudioSnapshot, CamerasSnapshot } from "@sse/engine-client";

import type { DiskWord } from "../session/sessionDisk";
import { lastSyncWord, takesTodayWord } from "./overviewModel";

// The Overview's footer (the board's note 13): the day so far, quietly. CAM
// 1's takes since midnight with the minutes recorded (`takesToday`, from the
// action log), when the Console last read the desk, and the latest backup.
// The shell ends it with the product's name. The Session page (D51) shows
// the same footer. Since D52 it ends with the session's drive, `Disk 2.00 TB
// free on Storage 1`, its value yellow while the drive reads low and coral
// while it is nearly full (`footerDiskWord`).

export interface OverviewFooterProps {
  audio: AudioSnapshot | null;
  /** The latest backup's time, as the backups list prints it; `null` when there is none. */
  backup: string | null;
  /** The session's drive, as `footerDiskWord` says it. */
  disk: DiskWord;
  now: number;
  takesToday: CamerasSnapshot["takesToday"] | undefined;
  /** The footer's test id: the page's own. */
  testId?: string;
}

export function OverviewFooter({
  audio,
  backup,
  disk,
  now,
  takesToday,
  testId = "overview-footer",
}: OverviewFooterProps) {
  return (
    <Footer
      testId={testId}
      items={[
        { id: "takes", label: "Takes today", value: takesTodayWord(takesToday) },
        { id: "sync", label: "Last sync", value: lastSyncWord(audio, new Date(now)) },
        { id: "backup", label: "Backup", value: backup ?? "none yet" },
        { id: "disk", label: "Disk", value: disk.word, ...(disk.tone ? { tone: disk.tone } : {}) },
      ]}
    />
  );
}
