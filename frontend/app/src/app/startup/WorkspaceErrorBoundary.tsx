import { Component, type ErrorInfo, type ReactNode } from "react";

import { Key } from "@sse/design-system";

import { PreReadyState } from "./PreReadyState";
import styles from "./RecoveryBands.module.css";

/** An area's short name for the display's word, so `<AREA> STOPPED` fits the
 *  440 px display in any face (`TELEPROMPTER STOPPED` did not in PT Serif). */
export function shortAreaName(area: string): string {
  const name = area.split(" / ")[0] ?? area;
  return name === "Teleprompter" ? "Prompter" : name;
}

// 2026-09 production readiness, Slice 9 (finding F10): one boundary around
// whatever the bay is showing. A render error inside Lighting used to take the
// whole window with it — header, tabs, the restart and close dialogs — and
// leave a blank webview. Now the area that failed says so on the program's own
// state display, the rest of the shell stays up, and every other workspace is
// one tab away.
//
// The boundary adds no element of its own: while nothing has failed it renders
// its children as they are, so no surface moves. The host resets it by key —
// the area it wraps plus a counter that "Reload this area" advances — so
// switching workspaces always starts the next one clean.

export interface WorkspaceErrorBoundaryProps {
  /** What the operator calls the area: "Lighting", "Audio", "Setup / Support". */
  area: string;
  children: ReactNode;
  onError?: (error: Error, componentStack: string) => void;
  /** Advances the host's reset key, which remounts the boundary and the area. */
  onReset: () => void;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

export class WorkspaceErrorBoundary extends Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  state: WorkspaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): WorkspaceErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    // The visual overhaul (2026-10-05): the word is the area's short name
    // (`SETUP STOPPED`, `PROMPTER STOPPED`, which the 440 px display cut
    // whole), the display's sentence one line, and the whole sentence and the
    // error's own words in the bay, where nothing cuts them.
    const area = shortAreaName(this.props.area);
    return (
      <PreReadyState
        tone="error"
        word={`${area} stopped`.toUpperCase()}
        sentence="This area stopped drawing."
        actions={
          <Key size="small" mode="primary" testId="workspace-boundary-reload" onClick={this.props.onReset}>
            Reload this area
          </Key>
        }
        testId="workspace-boundary"
      >
        <p className={styles.sentence}>
          This area hit a problem and stopped drawing. The rest of Studio Control keeps working and the hardware link
          keeps running, so the desk, the rig and the deck hold their current state.
        </p>
        <p className={styles.code} data-state-code="">
          {error.message}
        </p>
        <p className={styles.nextStep}>
          Reload this area to bring it back. If it stops again, export diagnostics from Setup / Support.
        </p>
      </PreReadyState>
    );
  }
}
