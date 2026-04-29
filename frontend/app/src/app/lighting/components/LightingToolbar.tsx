import { useState, type ChangeEvent } from "react";
import { MoreVertical, Pencil, Plus, Search, Sun } from "lucide-react";

import { Button, StatusDot, Tooltip } from "@sse/design-system";

import { KeyboardShortcutsPopover } from "./KeyboardShortcutsPopover";
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
          {patchMode ? <span className={styles.patchEyebrow}>Patch mode</span> : null}
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

      {shortcutsOpen ? <KeyboardShortcutsPopover onClose={() => setShortcutsOpen(false)} /> : null}
    </>
  );
}
