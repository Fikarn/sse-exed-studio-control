import { useState } from "react";

import { Key, StatusBand } from "@sse/design-system";
import type { BackgroundFailure } from "@sse/engine-client";

import styles from "./BackgroundFailureBand.module.css";

// 2026-09 production readiness, Slice 9 (finding F10): what went wrong in the
// background — a refresh the hardware link did not answer, a reply that was
// refused, an error nothing caught — used to be visible only in a diagnostics
// export. One band at the foot of the bay now says that it happened, how often
// and since when. It names no cause: the ring in the diagnostics export does
// that, for whoever reads the support ticket.
//
// It is absent while nothing has failed, so no surface moves, and Dismiss puts
// it away until the next failure.

const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function describeBackgroundFailures(failures: readonly BackgroundFailure[]) {
  // A band about failures must not be one: `format` throws on an invalid date.
  const firstAt = failures[0] ? new Date(failures[0].at) : null;
  const since = firstAt && !Number.isNaN(firstAt.getTime()) ? clockFormat.format(firstAt) : null;
  const count = failures.length === 1 ? "1 problem" : `${failures.length} problems`;
  return `${count}${since ? ` since ${since}` : ""}. What is on screen keeps working. If it keeps happening, export diagnostics from Setup / Support.`;
}

export function BackgroundFailureBand({ failures }: { failures: readonly BackgroundFailure[] }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = failures[failures.length - 1];
  // The ring holds the last twenty, so the newest entry's time — not the
  // count — is what tells a new failure from the ones already dismissed.
  const mark = latest ? `${failures.length}:${latest.at}` : null;
  if (mark === null || mark === dismissed) {
    return null;
  }

  return (
    <StatusBand
      className={styles.band}
      tone="warning"
      title="Studio Control hit a problem in the background"
      summary={describeBackgroundFailures(failures)}
      actions={
        <Key size="small" testId="background-failure-dismiss" onClick={() => setDismissed(mark)}>
          Dismiss
        </Key>
      }
      data-testid="background-failure-band"
    />
  );
}
