import { type ChangeEvent } from "react";
import { MoreVertical, Pencil, Plus, Search, Sun } from "lucide-react";

import { Button, StatusDot, Tooltip } from "@sse/design-system";

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
  onOpenMenu?: () => void;
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
  onOpenMenu,
}: LightingToolbarProps) {
  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value);
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Lighting workspace toolbar">
      <div className={styles.title}>
        <Sun aria-hidden="true" className={styles.titleIcon} size={17} strokeWidth={1.75} />
        <span>Lighting</span>
      </div>

      <span
        className={`${styles.chip} ${bridgeReachable ? styles.chipGreen : styles.chipErr}`}
        title={bridgeIp ? `${bridgeIp}` : "No bridge configured"}
      >
        <StatusDot state={bridgeReachable ? "ok" : "err"} size="sm" />
        DMX U{bridgeUniverse} · {bridgeReachable ? "reachable" : "unreachable"}
      </span>

      <span className={styles.divider} aria-hidden="true" />

      <div className={styles.stats}>
        <Tooltip content="Fixtures patched on the rig" placement="bottom">
          <div className={styles.stat}>
            <span className={styles.statValue}>{fixtureCount}</span>
            <span className={styles.statLabel}>Fix</span>
          </div>
        </Tooltip>
        <Tooltip content="Fixtures currently emitting" placement="bottom">
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
          aria-label="Search fixtures"
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
        Fixture
      </Button>

      <button type="button" className={styles.kebab} onClick={onOpenMenu} aria-label="Open lighting menu">
        <MoreVertical aria-hidden="true" size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
