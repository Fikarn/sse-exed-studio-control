import { Key, Section } from "@sse/design-system";
import type { StartupFailure } from "@sse/engine-client";

import { asRecord, type SnapshotRecord } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import recoveryStyles from "./RecoveryBands.module.css";
import { formatFailureCode, formatFailureStage, formatPathLabel, getFailureTitle } from "./startupHelpers";

// Visual overhaul A, Slice 7: a failed start on the same skeleton. The word is
// what failed, the sentence is the engine's own, the code stands in the
// display's code slot, and Retry startup is the key on the display. Every band
// below it names the next step the operator takes.

export function RecoverySurface({
  failure,
  healthSnapshot,
  onRequestRestart,
  onShowShortcuts,
}: {
  failure: StartupFailure | null;
  healthSnapshot: SnapshotRecord | null;
  onRequestRestart: () => void;
  onShowShortcuts: () => void;
}) {
  const healthPaths = asRecord(healthSnapshot?.paths);
  const paths = failure?.paths
    ? Object.entries(failure.paths)
    : healthPaths
      ? Object.entries(healthPaths).map(([key, value]) => [key, String(value)] as const)
      : [];
  const summary =
    failure?.message ??
    String(
      healthSnapshot?.summary ??
        "Studio Control stopped before it was ready. Retry startup, then export diagnostics from Setup / Support."
    );
  const details = Object.entries(asRecord(healthSnapshot?.details) ?? {});
  const recentLogExcerpt = Array.isArray(healthSnapshot?.recentLogExcerpt)
    ? healthSnapshot.recentLogExcerpt.flatMap((line) => (typeof line === "string" ? [line] : []))
    : [];

  return (
    <PreReadyState
      tone="error"
      word={getFailureTitle(failure).toUpperCase()}
      sentence={summary}
      code={failure?.code}
      meta={`${formatFailureCode(failure)} · ${
        failure?.stage ? `failed at the ${formatFailureStage(failure.stage)} step` : "no stage reported"
      } · recover from Setup / Support`}
      actions={
        <>
          <Key size="small" mode="primary" testId="recovery-retry" onClick={onRequestRestart}>
            Retry startup
          </Key>
          <Key size="small" cap="Shortcuts" hint="?" testId="recovery-shortcuts" onClick={onShowShortcuts} />
        </>
      }
      testId="recovery-surface"
    >
      {failure?.code === "PROTOCOL_MISMATCH" ? (
        <Section title="Protocol" detail="what Studio Control asked for and what answered" testId="recovery-protocol">
          <div className={recoveryStyles.rows}>
            <div className={recoveryStyles.row}>
              <span>Requested protocol</span>
              <b>{failure.requestedProtocol ?? "not reported"}</b>
            </div>
            <div className={recoveryStyles.row}>
              <span>Reported protocol</span>
              <b>{failure.supportedProtocol ?? "not reported"}</b>
            </div>
          </div>
          <p className={recoveryStyles.nextStep}>
            Next: install Studio Control from a single release, then retry startup.
          </p>
        </Section>
      ) : null}

      <Section title="What to do next" detail="in this order" testId="recovery-guidance">
        <ul className={recoveryStyles.list}>
          <li>Retry startup once. A clean restart clears most transient failures.</li>
          <li>If it fails again, collect diagnostics from the Engine log path below before changing anything.</li>
          <li>Do not open Lighting or Audio until startup recovers cleanly.</li>
        </ul>
      </Section>

      <Section
        title="Recovery evidence"
        detail={details.length > 0 ? `${details.length} entries from Studio Control` : "nothing published"}
        testId="recovery-evidence"
      >
        {details.length > 0 ? (
          <div className={recoveryStyles.rows}>
            {details.map(([key, value]) => (
              <div key={key} className={recoveryStyles.row}>
                <span>{formatPathLabel(key)}</span>
                <b>{String(value)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className={recoveryStyles.nextStep}>
            Startup failed before Studio Control could write detailed health diagnostics. Next: retry startup and watch
            the Engine log.
          </p>
        )}
      </Section>

      <Section title="File paths" detail={paths.length > 0 ? "where to look" : "none attached"} testId="recovery-paths">
        {paths.length > 0 ? (
          <div className={recoveryStyles.rows}>
            {paths.map(([key, value]) => (
              <div key={key} className={recoveryStyles.row}>
                <span>{formatPathLabel(key)}</span>
                <b>{String(value)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className={recoveryStyles.nextStep}>
            No file paths were attached to this startup failure. Next: retry startup, then export diagnostics from Setup
            / Support.
          </p>
        )}
      </Section>

      {recentLogExcerpt.length > 0 ? (
        <Section
          title="Recent log excerpt"
          detail="the last lines Studio Control wrote — export diagnostics from Setup / Support to keep them"
          testId="recovery-log"
        >
          <pre className={recoveryStyles.log}>{recentLogExcerpt.join("\n")}</pre>
        </Section>
      ) : null}
    </PreReadyState>
  );
}
