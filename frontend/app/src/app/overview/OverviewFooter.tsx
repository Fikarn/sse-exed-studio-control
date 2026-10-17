import { Footer } from "@sse/design-system";
import type { AudioSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { lastSyncWord, takesTodayWord } from "./overviewModel";

// The Overview's footer (the board's note 13): the day so far, quietly. CAM
// 1's takes since midnight with the minutes recorded (`takesToday`, from the
// action log), when the Console last read the desk, and the latest backup.
// The shell ends it with the product's name. The Session page (D51) shows
// the same footer.

export interface OverviewFooterProps {
  audio: AudioSnapshot | null;
  /** The latest backup's time, as the backups list prints it; `null` when there is none. */
  backup: string | null;
  now: number;
  takesToday: CamerasSnapshot["takesToday"] | undefined;
  /** The footer's test id: the page's own. */
  testId?: string;
}

export function OverviewFooter({ audio, backup, now, takesToday, testId = "overview-footer" }: OverviewFooterProps) {
  return (
    <Footer
      testId={testId}
      items={[
        { id: "takes", label: "Takes today", value: takesTodayWord(takesToday) },
        { id: "sync", label: "Last sync", value: lastSyncWord(audio, new Date(now)) },
        { id: "backup", label: "Backup", value: backup ?? "none yet" },
      ]}
    />
  );
}
