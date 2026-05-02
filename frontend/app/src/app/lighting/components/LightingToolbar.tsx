import { useState, type ChangeEvent } from "react";
import { Crosshair, EyeOff, Lightbulb, Locate, MoreVertical, Pencil, Plus, Search, Sun, X } from "lucide-react";

import { Button, StatusDot, Tooltip } from "@sse/design-system";

import { ShortcutOverlay } from "../../shared/ShortcutOverlay";
import styles from "./LightingToolbar.module.css";

export interface LightingToolbarProps {
  bridgeUniverse: number;
  bridgeIp: string;
  bridgeReachable: boolean;
  fixtureCount: number;
  fixtureOnCount: number;
  groupCount: number;
  sceneCount: number;
  recallFadeMs: number;
  searchQuery: string;
  onSearchChange: (next: string) => void;
  onRecallFadeMsChange: (nextMs: number) => void;
  patchMode: boolean;
  onTogglePatch: () => void;
  previewMode: boolean;
  previewDirty: boolean;
  onTogglePreview: () => void;
  onAddFixture: () => void;
  /** I2 — Highlight/Solo overlay states + Find sequence trigger.
   *  Selection-driven: buttons gate on hasSelection so operators don't
   *  fire IPCs against an empty target. */
  hasSelection: boolean;
  highlightActive: boolean;
  soloActive: boolean;
  onToggleHighlight: () => void;
  onToggleSolo: () => void;
  onIdentifyFind: () => void;
}

export function LightingToolbar({
  bridgeUniverse,
  bridgeIp,
  bridgeReachable,
  fixtureCount,
  fixtureOnCount,
  groupCount,
  sceneCount,
  recallFadeMs,
  searchQuery,
  onSearchChange,
  onRecallFadeMsChange,
  patchMode,
  onTogglePatch,
  previewMode,
  previewDirty,
  onTogglePreview,
  onAddFixture,
  hasSelection,
  highlightActive,
  soloActive,
  onToggleHighlight,
  onToggleSolo,
  onIdentifyFind,
}: LightingToolbarProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value);
  };

  const handleFadeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const seconds = Number(event.target.value);
    if (!Number.isFinite(seconds)) return;
    onRecallFadeMsChange(Math.round(Math.max(0, Math.min(10, seconds)) * 1000));
  };

  const recallFadeSeconds = Math.round((recallFadeMs / 1000) * 10) / 10;

  return (
    <>
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label="Lighting workspace toolbar"
        data-patch-mode={patchMode || undefined}
        data-preview-mode={previewMode || undefined}
      >
        <div className={styles.title}>
          <Sun aria-hidden="true" className={styles.titleIcon} size={17} strokeWidth={1.75} />
          <span>Lighting</span>
          {patchMode ? (
            // F11 — persistent on-screen exit affordance. Replaces the static
            // "Patch mode" eyebrow with a clickable pill so the keyboard
            // shortcut isn't the only way out. Click toggles patch off
            // (handlers in LightingWorkspace already cover the toggle).
            <Button
              size="compact"
              variant="primary"
              onClick={onTogglePatch}
              leadingVisual={<X aria-hidden="true" size={13} strokeWidth={2} />}
              aria-pressed={patchMode}
            >
              Exit patch mode <kbd className={styles.kbd}>P</kbd>
            </Button>
          ) : null}
          {previewMode ? (
            <span className={styles.previewEyebrow}>Preview {previewDirty ? "dirty" : "clean"}</span>
          ) : null}
        </div>

        <Tooltip content={bridgeIp ? bridgeIp : "No bridge configured"} placement="bottom">
          <span className={`${styles.chip} ${bridgeReachable ? styles.chipGreen : styles.chipErr}`}>
            <StatusDot state={bridgeReachable ? "ok" : "err"} size="sm" />
            DMX U{bridgeUniverse} · {bridgeReachable ? "reachable" : "unreachable"}
          </span>
        </Tooltip>

        <span className={styles.divider} aria-hidden="true" />

        <div className={styles.stats}>
          <Tooltip content="Fixtures patched on the rig" placement="bottom">
            <div className={styles.stat}>
              <span className={styles.statValue}>{fixtureCount}</span>
              <span className={styles.statLabel}>Fix</span>
            </div>
          </Tooltip>
          <Tooltip content="Fixtures currently on" placement="bottom">
            <div className={styles.stat}>
              <span className={styles.statValue}>{fixtureOnCount}</span>
              <span className={styles.statLabel}>On</span>
            </div>
          </Tooltip>
          <Tooltip content="Groups defined" placement="bottom">
            <div className={styles.stat}>
              <span className={styles.statValue}>{groupCount}</span>
              <span className={styles.statLabel}>Grp</span>
            </div>
          </Tooltip>
          <Tooltip content="Scenes saved" placement="bottom">
            <div className={styles.stat}>
              <span className={styles.statValue}>{sceneCount}</span>
              <span className={styles.statLabel}>Scn</span>
            </div>
          </Tooltip>
        </div>

        <span className={styles.spacer} />

        <label className={styles.fadeControl}>
          <span className={styles.fadeLabel}>Fade</span>
          <input
            aria-label="Scene recall fade seconds"
            className={styles.fadeInput}
            disabled={previewMode}
            min={0}
            max={10}
            onChange={handleFadeChange}
            step={0.5}
            type="number"
            value={recallFadeSeconds}
          />
          <span className={styles.fadeUnit}>s</span>
        </label>

        <label className={styles.search}>
          <Search aria-hidden="true" size={12} strokeWidth={1.75} />
          <input
            aria-label="Search fixtures, scenes and groups"
            className={styles.searchInput}
            onChange={handleSearch}
            placeholder="Search fixtures…"
            type="search"
            value={searchQuery}
          />
        </label>

        <Button
          size="compact"
          variant={patchMode ? "primary" : "secondary"}
          onClick={onTogglePatch}
          leadingVisual={<Pencil aria-hidden="true" size={13} strokeWidth={1.75} />}
          aria-pressed={patchMode}
          disabled={previewMode}
        >
          Patch <kbd className={styles.kbd}>P</kbd>
        </Button>

        {/* I2 + F12 — Highlight, Solo, Find. Selection-gated so the
            operator can't fire them against an empty target. Highlight
            and Solo are mutually exclusive at the engine layer; the
            toolbar reflects that by showing only one as `primary` at a
            time. */}
        <Tooltip
          content={hasSelection ? "Hold selection at full white at neutral CCT" : "Select fixtures to enable Highlight"}
          placement="bottom"
        >
          <Button
            size="compact"
            variant={highlightActive ? "primary" : "secondary"}
            onClick={onToggleHighlight}
            leadingVisual={<Lightbulb aria-hidden="true" size={13} strokeWidth={1.75} />}
            aria-pressed={highlightActive}
            disabled={previewMode || (!hasSelection && !highlightActive)}
          >
            Highlight <kbd className={styles.kbd}>H</kbd>
          </Button>
        </Tooltip>

        <Tooltip
          content={hasSelection ? "Dim every fixture except the selection" : "Select fixtures to enable Solo"}
          placement="bottom"
        >
          <Button
            size="compact"
            variant={soloActive ? "primary" : "secondary"}
            onClick={onToggleSolo}
            leadingVisual={<Crosshair aria-hidden="true" size={13} strokeWidth={1.75} />}
            aria-pressed={soloActive}
            disabled={previewMode || (!hasSelection && !soloActive)}
          >
            Solo <kbd className={styles.kbd}>⇧H</kbd>
          </Button>
        </Tooltip>

        <Tooltip
          content={
            hasSelection
              ? "Pulse the selection in turn so you can locate each fixture"
              : "Select fixtures to enable Find"
          }
          placement="bottom"
        >
          <Button
            size="compact"
            variant="secondary"
            onClick={onIdentifyFind}
            leadingVisual={<Locate aria-hidden="true" size={13} strokeWidth={1.75} />}
            disabled={previewMode || !hasSelection}
          >
            Find <kbd className={styles.kbd}>⇧I</kbd>
          </Button>
        </Tooltip>

        <Tooltip
          content={patchMode ? "Exit patch mode before preview editing." : "Edit scene levels offline"}
          placement="bottom"
        >
          <Button
            size="compact"
            variant={previewMode ? "primary" : "secondary"}
            onClick={onTogglePreview}
            leadingVisual={<EyeOff aria-hidden="true" size={13} strokeWidth={1.75} />}
            aria-pressed={previewMode}
            disabled={patchMode}
          >
            Preview <kbd className={styles.kbd}>B</kbd>
          </Button>
        </Tooltip>

        <Button
          size="compact"
          variant="primary"
          onClick={onAddFixture}
          leadingVisual={<Plus aria-hidden="true" size={13} strokeWidth={2} />}
          disabled={previewMode}
        >
          Add fixture
        </Button>

        <button
          type="button"
          className={styles.kebab}
          onClick={() => setShortcutsOpen(true)}
          aria-label="Keyboard shortcuts"
          aria-haspopup="dialog"
          aria-expanded={shortcutsOpen}
        >
          <MoreVertical aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      </div>

      {shortcutsOpen ? <ShortcutOverlay onClose={() => setShortcutsOpen(false)} /> : null}
    </>
  );
}
