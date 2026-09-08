import { Key, Section } from "@sse/design-system";
import type { StartupFailure } from "@sse/engine-client";

import { asRecord, type SnapshotRecord } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import recoveryStyles from "./RecoveryBands.module.css";
import { formatFailureCode, getFailureTitle } from "./startupHelpers";

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
  const summary = failure?.message ?? String(healthSnapshot?.summary ?? "The shell needs operator recovery.");
  const details = Object.entries(asRecord(healthSnapshot?.details) ?? {});
  const recentLogExcerpt = Array.isArray(healthSnapshot?.recentLogExcerpt)
    ? healthSnapshot.recentLogExcerpt.flatMap((line) => (typeof line === "string" ? [line] : []))
    : [];

  return (
    <PreReadyState
      tone="error"
      word={getFailureTitle(failure).toUpperCase()}
      sentence={summary}
      code={failure?.code ?? "ENGINE_STARTUP_FAILED"}
      meta={`${formatFailureCode(failure)} · failed at ${failure?.stage ?? "runtime"} · recover from Setup / Support`}
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
        <Section title="Protocol" detail="what the shell asked for and what answered" testId="recovery-protocol">
          <div className={recoveryStyles.rows}>
            <div className={recoveryStyles.row}>
              <span>Requested protocol</span>
              <b>{failure.requestedProtocol ?? "unknown"}</b>
            </div>
            <div className={recoveryStyles.row}>
              <span>Reported protocol</span>
              <b>{failure.supportedProtocol ?? "unknown"}</b>
            </div>
          </div>
          <p className={recoveryStyles.nextStep}>
            Next: install the app and engine from the same release, then retry startup.
          </p>
        </Section>
      ) : null}

      <Section title="What to do next" detail="in this order" testId="recovery-guidance">
        <ul className={recoveryStyles.list}>
          <li>Retry startup once. A clean restart clears most transient failures.</li>
          <li>If it fails again, collect diagnostics from the engine log path below before changing anything.</li>
          <li>Do not open lighting or audio until startup recovers cleanly.</li>
        </ul>
      </Section>

      <Section
        title="Recovery evidence"
        detail={details.length > 0 ? `${details.length} from the engine` : "nothing published"}
        testId="recovery-evidence"
      >
        {details.length > 0 ? (
          <div className={recoveryStyles.rows}>
            {details.map(([key, value]) => (
              <div key={key} className={recoveryStyles.row}>
                <span>{key}</span>
                <b>{String(value)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className={recoveryStyles.nextStep}>
            Startup failed before the engine could publish detailed health diagnostics. Next: retry startup and watch
            the log.
          </p>
        )}
      </Section>

      <Section
        title="Runtime paths"
        detail={paths.length > 0 ? "where to look" : "none attached"}
        testId="recovery-paths"
      >
        {paths.length > 0 ? (
          <div className={recoveryStyles.rows}>
            {paths.map(([key, value]) => (
              <div key={key} className={recoveryStyles.row}>
                <span>{key}</span>
                <b>{String(value)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className={recoveryStyles.nextStep}>
            No runtime paths were attached to this startup failure. Next: retry startup, then export diagnostics from
            Setup / Support.
          </p>
        )}
      </Section>

      {recentLogExcerpt.length > 0 ? (
        <Section title="Recent log excerpt" detail="the last lines the engine wrote" testId="recovery-log">
          <pre className={recoveryStyles.log}>{recentLogExcerpt.join("\n")}</pre>
        </Section>
      ) : null}
    </PreReadyState>
  );
}
