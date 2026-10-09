import { Footer } from "@sse/design-system";
import type { AudioSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { lastSyncWord, takesTodayWord } from "./overviewModel";

// The Overview's footer (the board's note 13): the day so far, quietly. CAM
// 1's takes since midnight with the minutes recorded (`takesToday`, from the
// action log), when the Console last read the desk, and the latest backup.
// The shell ends it with the product's name.

export interface OverviewFooterProps {
  audio: AudioSnapshot | null;
  /** The latest backup's time, as the backups list prints it; `null` when there is none. */
  backup: string | null;
  now: number;
  takesToday: CamerasSnapshot["takesToday"] | undefined;
}

export function OverviewFooter({ audio, backup, now, takesToday }: OverviewFooterProps) {
  return (
    <Footer
      testId="overview-footer"
      items={[
        { id: "takes", label: "Takes today", value: takesTodayWord(takesToday) },
        { id: "sync", label: "Last sync", value: lastSyncWord(audio, new Date(now)) },
        { id: "backup", label: "Backup", value: backup ?? "none yet" },
      ]}
    />
  );
}
