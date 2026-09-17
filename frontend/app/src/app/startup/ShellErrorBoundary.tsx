import { Component, type ErrorInfo, type ReactNode } from "react";

import { Key } from "@sse/design-system";
import type { JsonValue } from "@sse/engine-client";

import { exportShellDiagnostics } from "../shellCommands";
import { PreReadyState } from "./PreReadyState";
import recoveryStyles from "./RecoveryBands.module.css";
import styles from "./ShellErrorBoundary.module.css";

// 2026-09 production readiness, Slice 9 (finding F10): the last boundary, at
// the root. Whatever the workspace boundary cannot catch — the shell frame,
// a provider, the store's own hook — lands here instead of on a blank webview.
// The page depends on nothing that may be what failed: no store, no provider,
// no layout context. It says what happened, reloads the screen, and writes a
// diagnostics file that carries the error whether or not a store exists.
//
// A reload restarts the screen only. The shell hands a reloaded screen the
// hardware link that is already running, so nothing on the desk, the rig or
// the deck changes while the operator recovers.

export interface ShellErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, componentStack: string) => void;
  /** What the diagnostics file carries beside the error. Called on export; may throw. */
  collectDiagnostics?: () => Record<string, JsonValue>;
  /** Defaults to reloading the page. */
  onReload?: () => void;
}

interface ShellErrorBoundaryState {
  componentStack: string;
  error: Error | null;
  exportMessage: string | null;
  exporting: boolean;
}

export class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = { componentStack: "", error: null, exportMessage: null, exporting: false };

  static getDerivedStateFromError(error: unknown): Partial<ShellErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
    this.props.onError?.(error, info.componentStack ?? "");
  }

  private reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  private exportDiagnostics = async () => {
    const { componentStack, error } = this.state;
    if (!error || this.state.exporting) {
      return;
    }
    this.setState({ exporting: true, exportMessage: null });

    let collected: Record<string, JsonValue> | null = null;
    let collectFailure: string | null = null;
    try {
      collected = this.props.collectDiagnostics?.() ?? null;
    } catch (collectError) {
      collectFailure = collectError instanceof Error ? collectError.message : String(collectError);
    }

    try {
      const path = await exportShellDiagnostics({
        collectFailure,
        componentStack,
        error: { message: error.message, name: error.name, stack: error.stack ?? null },
        generatedAt: new Date().toISOString(),
        shellState: collected,
        source: "screen error",
      });
      this.setState({
        exporting: false,
        exportMessage: `Diagnostics exported to ${path}. Attach it to the support ticket.`,
      });
    } catch (exportError) {
      const reason = exportError instanceof Error ? exportError.message : String(exportError);
      this.setState({ exporting: false, exportMessage: `Diagnostics were not exported: ${reason}` });
    }
  };

  render() {
    const { error, exportMessage, exporting } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className={styles.page} role="alert">
        <PreReadyState
          tone="error"
          word="THIS SCREEN STOPPED"
          sentence="Studio Control hit a problem it could not draw past. The hardware link keeps running, so the desk, the rig and the deck hold their current state. Reload to start the screen again."
          code={error.message}
          meta="Export diagnostics before you reload if this keeps happening"
          actions={
            <>
              <Key size="small" mode="primary" testId="shell-boundary-reload" onClick={this.reload}>
                Reload
              </Key>
              <Key
                size="small"
                testId="shell-boundary-export"
                disabled={exporting}
                onClick={() => void this.exportDiagnostics()}
              >
                Export diagnostics
              </Key>
            </>
          }
          testId="shell-boundary"
        >
          {exportMessage ? (
            <p className={recoveryStyles.nextStep} data-testid="shell-boundary-export-result">
              {exportMessage}
            </p>
          ) : null}
        </PreReadyState>
      </div>
    );
  }
}
