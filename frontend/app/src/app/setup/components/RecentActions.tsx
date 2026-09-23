import { Section, StatusBadge, type StatusTone } from "@sse/design-system";

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

// Who did it, in the operator's words. The watchdog acted because nobody did,
// so its word stands out; a start-up row is information, not a state.
const SOURCE_WORDS: Record<string, { tone: StatusTone; word: string }> = {
  console: { tone: "neutral", word: "Console" },
  deck: { tone: "neutral", word: "Stream Deck" },
  launch: { tone: "info", word: "Start-up" },
  ui: { tone: "neutral", word: "Screen" },
  watchdog: { tone: "attention", word: "Watchdog" },
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

export function RecentActions({ actions }: RecentActionsProps) {
  const shown = actions.slice(0, RECENT_ACTIONS_SHOWN);
  return (
    <Section title="Recent actions" detail="newest first · who did it" testId="support-recent-actions">
      {shown.length > 0 ? (
        <ol className={styles.list}>
          {shown.map((action) => {
            const source = SOURCE_WORDS[action.source] ?? { tone: "neutral" as const, word: action.source };
            return (
              <li
                key={action.id}
                className={styles.row}
                data-source={action.source}
                data-testid="support-recent-action"
              >
                <span className={styles.detail} title={action.detail}>
                  {action.detail}
                </span>
                <span className={styles.source}>
                  <StatusBadge label={source.word} tone={source.tone} />
                </span>
                <time className={styles.time} dateTime={action.at}>
                  {formatActionTime(action.at)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.empty} data-testid="support-recent-actions-empty">
          Nothing yet. Power, recalls, mutes, 48 V and talkback show here, with who did them.
        </p>
      )}
    </Section>
  );
}
