import { useState, type ChangeEvent } from "react";
import { Crosshair, Lightbulb, Locate, MoreVertical, Pencil, Plus, Search, Sun, X } from "lucide-react";

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
  searchQuery: string;
  onSearchChange: (next: string) => void;
  patchMode: boolean;
  onTogglePatch: () => void;
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
  searchQuery,
  onSearchChange,
  patchMode,
  onTogglePatch,
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

  return (
    <>
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label="Lighting workspace toolbar"
        data-patch-mode={patchMode || undefined}
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
            disabled={!hasSelection && !highlightActive}
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
            disabled={!hasSelection && !soloActive}
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
            disabled={!hasSelection}
          >
            Find <kbd className={styles.kbd}>⇧I</kbd>
          </Button>
        </Tooltip>

        <Button
          size="compact"
          variant="primary"
          onClick={onAddFixture}
          leadingVisual={<Plus aria-hidden="true" size={13} strokeWidth={2} />}
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
