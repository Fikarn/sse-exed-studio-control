import { useState } from "react";

import { Key, Section } from "@sse/design-system";
import type { StartupFailure } from "@sse/engine-client";

import { resetWindowLayout } from "../shellCommands";
import { asRecord, type SnapshotRecord } from "../shellData";
import { PreReadyState } from "./PreReadyState";
import recoveryStyles from "./RecoveryBands.module.css";
import { formatFailureCode, formatFailureStage, formatPathLabel, getFailureTitle } from "./startupHelpers";

// Visual overhaul A, Slice 7: a failed start on the same skeleton. The word is
// what failed, the sentence is the engine's own, the code stands in the
// display's code slot, and Retry startup is the key on the display. Every band
// below it names the next step the operator takes. New pages program, Slice 3
// (decision 2): Reset the window layout sits beside Retry startup, for a
// window that came back on the wrong screen; a refusal is a band of its own.

/**
 * The health snapshot's log excerpt as lines. The hardware link has always
 * sent one string (the last lines of its log, `native/protocol/v1.md`); this
 * surface used to read a list, which only the fixtures carried, so on the
 * workstation the section never appeared (2026-09 production readiness,
 * Slice 9). A list is still read, for a reply from an older build.
 */
export function readLogExcerpt(value: unknown): string[] {
  const lines = typeof value === "string" ? value.split(/\r?\n/) : Array.isArray(value) ? value : [];
  return lines.flatMap((line) => (typeof line === "string" && line.trim().length > 0 ? [line] : []));
}

export function RecoverySurface({
  failure,
  healthSnapshot,
  onRequestRestart,
}: {
  failure: StartupFailure | null;
  healthSnapshot: SnapshotRecord | null;
  onRequestRestart: () => void;
}) {
  const [resettingWindow, setResettingWindow] = useState(false);
  const [windowRefusal, setWindowRefusal] = useState<string | null>(null);
  const resetWindow = async () => {
    setResettingWindow(true);
    setWindowRefusal(null);
    try {
      await resetWindowLayout();
    } catch (error) {
      setWindowRefusal(error instanceof Error ? error.message : "The window layout was not reset.");
    } finally {
      setResettingWindow(false);
    }
  };
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
  const recentLogExcerpt = readLogExcerpt(healthSnapshot?.recentLogExcerpt);

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
          <Key
            size="small"
            disabled={resettingWindow}
            testId="recovery-window-reset"
            onClick={() => void resetWindow()}
          >
            Reset the window layout
          </Key>
        </>
      }
      testId="recovery-surface"
    >
      {/* The shell's sentence says what did not happen, once; the band adds
          only the way on. With Setup / Support in Support mode the window keys
          are on screen at any window size, under Workstation: on the plate at
          the studio surface, under the Support screen in a window (review
          findings 22, 23). */}
      {windowRefusal ? (
        <Section title="Window" testId="recovery-window-refusal">
          <p className={recoveryStyles.nextStep} role="status">
            {windowRefusal} Next: retry startup, then open Setup / Support and press Support: Reset the window layout is
            under Workstation.
          </p>
        </Section>
      ) : null}

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
