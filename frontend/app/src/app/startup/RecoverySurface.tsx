import { Button, MetricCard, StatusBadge, Surface } from "@sse/design-system";
import type { StartupFailure } from "@sse/engine-client";

import { asRecord, type SnapshotRecord } from "../shellData";
import styles from "../OperatorShell.module.css";
import { getFailureTitle } from "./startupHelpers";

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
    <div className={styles.stateShell}>
      <Surface className={styles.stateSurface} padding="lg" tone="raised">
        <div className={styles.stateHeader}>
          <div>
            <div className={styles.stateEyebrow}>Recovery posture</div>
            <h1 className={styles.stateTitle}>{getFailureTitle(failure)}</h1>
            <p className={styles.stateSubtitle}>{summary}</p>
          </div>
          <StatusBadge label={failure?.code ?? "startup-failed"} tone="error" />
        </div>
        <div className={styles.metricGrid}>
          <MetricCard caption="Stage" tone="error" value={failure?.stage ?? "runtime"} />
          <MetricCard caption="Code" tone="warning" value={failure?.code ?? "ENGINE_STARTUP_FAILED"} />
          <MetricCard caption="Recovery mode" tone="ready" value="Setup / Support" />
        </div>
        {failure?.code === "PROTOCOL_MISMATCH" ? (
          <div className={styles.protocolSummary}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Requested protocol</div>
              <div className={styles.metaValue}>{failure.requestedProtocol ?? "unknown"}</div>
            </div>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Reported protocol</div>
              <div className={styles.metaValue}>{failure.supportedProtocol ?? "unknown"}</div>
            </div>
          </div>
        ) : null}
        <div className={styles.recoveryGrid}>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>Operator guidance</div>
            <ul className={styles.supportList}>
              <li>Do not proceed to lighting or audio until startup recovers cleanly.</li>
              <li>Collect diagnostics from the engine log path before changing persistence state.</li>
              <li>Use a clean restart first, then escalate to storage or protocol investigation.</li>
            </ul>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>Recovery evidence</div>
            {details.length > 0 ? (
              <ul className={styles.detailList}>
                {details.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.pathKey}>{key}</span>
                    <span className={styles.pathValue}>{String(value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.footerNote}>
                Startup failed before the engine could publish detailed health diagnostics.
              </div>
            )}
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>Runtime paths</div>
            <ul className={styles.pathList}>
              {paths.length > 0 ? (
                paths.map(([key, value]) => (
                  <li key={key}>
                    <span className={styles.pathKey}>{key}</span>
                    <span className={styles.pathValue}>{String(value)}</span>
                  </li>
                ))
              ) : (
                <li>No runtime paths were attached to this startup failure.</li>
              )}
            </ul>
          </div>
        </div>
        {recentLogExcerpt.length > 0 ? (
          <div className={styles.metaItem}>
            <div className={styles.metaLabel}>Recent log excerpt</div>
            <pre className={styles.logExcerpt}>{recentLogExcerpt.join("\n")}</pre>
          </div>
        ) : null}
        <div className={styles.actionRow}>
          <Button variant="primary" onClick={onRequestRestart}>
            Retry startup
          </Button>
          <Button variant="ghost" onClick={onShowShortcuts}>
            Keyboard shortcuts
          </Button>
        </div>
      </Surface>
    </div>
  );
}
