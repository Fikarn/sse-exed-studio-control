import { useState, type RefObject } from "react";

import { Key, Popover } from "@sse/design-system";
import type { PrompterScriptSummary, PrompterVersionSummary } from "@sse/engine-client";

import { clockTime } from "./teleprompterModel";
import styles from "./TeleprompterVersions.module.css";

// A script's earlier versions (the proposal §3.3), in a popover beside the
// plate's title (the visual overhaul, 2026-10-05): newest first, paged, each
// with Bring back, one press, which keeps the text it replaces as a version
// too. For the script on the prompter it changes only Studio Control's copy:
// the state reads `NOT UPDATED` until an update.

/** The versions shown at once, newest first; the hardware link keeps 20, paged. */
const VERSION_ROOM = 6;

/** Why a version was kept, as the plate says it (`PrompterVersionSummary.reason`). */
const VERSION_WORDS: Record<string, string> = {
  imported: "imported",
  pasted: "pasted",
  "put-on": "put on",
  replaced: "put on",
  updated: "updated",
  "before-file-update": "before a new file",
  "before-bringing-back": "before a bring back",
  "from-backup": "from a backup",
};

function versionLine(version: PrompterVersionSummary): string {
  const when = clockTime(version.keptAt);
  const why = VERSION_WORDS[version.reason] ?? "kept";
  return `${why}${when ? ` ${when}` : ""} · ${version.readWords.toLocaleString("en-GB")} words`;
}

export interface TeleprompterVersionsProps {
  /** The selected script: the popover follows the selection, not the row it was opened from. */
  script: PrompterScriptSummary;
  /** Its versions once read, newest first; `null` while they are read. */
  versions: readonly PrompterVersionSummary[] | null;
  /** What it stands beside: the plate's title. */
  anchor: HTMLElement | null;
  /** The ⋯ whose menu opened it: the focus goes back to it, and a press on it does not close it. */
  opener: RefObject<HTMLElement | null>;
  onBringBack: (versionId: number) => void;
  onClose: () => void;
}

export function TeleprompterVersions({
  script,
  versions,
  anchor,
  opener,
  onBringBack,
  onClose,
}: TeleprompterVersionsProps) {
  // The page belongs to the script it was turned for.
  const [turned, setTurned] = useState<{ scriptId: string; page: number }>({ scriptId: script.id, page: 0 });
  const pages = Math.max(Math.ceil((versions?.length ?? 0) / VERSION_ROOM), 1);
  const page = turned.scriptId === script.id ? Math.min(turned.page, pages - 1) : 0;
  const turn = (to: number) => setTurned({ scriptId: script.id, page: to });
  const shown = (versions ?? []).slice(page * VERSION_ROOM, (page + 1) * VERSION_ROOM);

  return (
    <Popover
      open
      anchor={anchor}
      onClose={onClose}
      title={`Earlier versions of ${script.name}`}
      placement="left-start"
      width={407}
      ignoreOutside={[opener]}
      returnFocusTo={opener.current}
      initialFocus="first"
      testId="teleprompter-versions-popover"
    >
      <ol className={styles.list} data-testid="teleprompter-version-list">
        {versions === null ? <li className={styles.none}>Reading…</li> : null}
        {versions && versions.length === 0 ? <li className={styles.none}>No earlier versions.</li> : null}
        {shown.map((version) => (
          <li key={version.id} className={styles.version}>
            <span className={styles.line}>{versionLine(version)}</span>
            <Key size="small" testId={`teleprompter-bring-back-${version.id}`} onClick={() => onBringBack(version.id)}>
              Bring back
            </Key>
          </li>
        ))}
      </ol>
      {pages > 1 ? (
        <div className={styles.pager}>
          <Key
            size="small"
            locked={page === 0}
            reason="These are the newest versions."
            testId="teleprompter-versions-newer"
            onClick={() => turn(page - 1)}
          >
            ◂ Newer
          </Key>
          <span>
            {page + 1} of {pages}
          </span>
          <Key
            size="small"
            locked={page === pages - 1}
            reason="These are the oldest versions kept."
            testId="teleprompter-versions-older"
            onClick={() => turn(page + 1)}
          >
            Older ▸
          </Key>
        </div>
      ) : null}
    </Popover>
  );
}
