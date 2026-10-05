import { Section, Tooltip } from "@sse/design-system";

import styles from "./RecentActions.module.css";

// 2026-09 production readiness, Slice 11 (F30): the newest rows of the action
// log — every discrete action that changed what a device receives, with who
// did it. The hardware link writes the sentence and sends fifty; the plate has
// room for the newest eight, and the diagnostics export carries them all.

export interface RecentAction {
  id: number;
  at: string;
  detail: string;
  source: string;
}

/** How many rows the plate shows; the rest travel in the diagnostics export. */
export const RECENT_ACTIONS_SHOWN = 8;

// Who did it, in the operator's words. A source without a word here is printed
// as it was saved.
const SOURCE_WORDS: Record<string, string> = {
  console: "Console",
  deck: "Stream Deck",
  launch: "Start-up",
  ui: "Screen",
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "short",
  second: "2-digit",
});

/** `17 Sep, 14:03:22` in the studio's local time; the text as sent when it is not a time. */
export function formatActionTime(at: string): string {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : timeFormat.format(parsed);
}

/** The rows of `support.snapshot`'s `recentEvents` this list can show; anything else is skipped. */
export function getRecentActions(supportSnapshot: Record<string, unknown> | null): RecentAction[] {
  const rows = supportSnapshot?.recentEvents;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const { at, detail, id, source } = row as Record<string, unknown>;
    if (typeof id !== "number" || typeof at !== "string" || typeof detail !== "string" || typeof source !== "string") {
      return [];
    }
    return [{ at, detail, id, source }];
  });
}

export interface RecentActionsProps {
  actions: readonly RecentAction[];
}

// The visual overhaul (2026-10-05): rows under hairlines, the sentence over
// when, who did it at the row's end in the quiet ink; a sentence too long for
// the row gives way, and its tooltip holds it whole.
export function RecentActions({ actions }: RecentActionsProps) {
  const shown = actions.slice(0, RECENT_ACTIONS_SHOWN);
  return (
    <Section
      title={
        <Tooltip
          content="The newest first: every action that changed what a device receives, and who did it. Power, recalls, mutes and 48 V show here."
          placement="left"
        >
          <span>Recent actions</span>
        </Tooltip>
      }
      testId="support-recent-actions"
    >
      {shown.length > 0 ? (
        <ol className={styles.list}>
          {shown.map((action) => (
            <li key={action.id} className={styles.row} data-source={action.source} data-testid="support-recent-action">
              <Tooltip content={action.detail} placement="left">
                <span className={styles.detail} data-cut-by-design="">
                  {action.detail}
                </span>
              </Tooltip>
              <span className={styles.source}>{SOURCE_WORDS[action.source] ?? action.source}</span>
              <time className={styles.time} dateTime={action.at}>
                {formatActionTime(action.at)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty} data-testid="support-recent-actions-empty">
          Nothing yet.
        </p>
      )}
    </Section>
  );
}
