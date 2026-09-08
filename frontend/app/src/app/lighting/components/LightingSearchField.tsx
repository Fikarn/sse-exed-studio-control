import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import styles from "./LightingSearchField.module.css";

// Visual overhaul A, Slice 5: the search the rig is filtered by, and the scenes
// most recently recalled hanging under it — the toolbar's field and its recent
// list, moved into the cluster with their keys intact (focus it with the search
// shortcut, arrow through the recents, Enter recalls).

export interface LightingRecentScene {
  id: string;
  name: string;
  lastRecalledLabel?: string;
}

export interface LightingSearchFieldProps {
  recentScenes: readonly LightingRecentScene[];
  searchQuery: string;
  onRecallRecentScene?: (sceneId: string) => void;
  onSearchChange: (value: string) => void;
}

export function LightingSearchField({
  recentScenes,
  searchQuery,
  onRecallRecentScene,
  onSearchChange,
}: LightingSearchFieldProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentActiveIndex, setRecentActiveIndex] = useState(0);
  const canShowRecent = searchQuery.trim().length === 0 && recentScenes.length > 0;

  useEffect(() => {
    if (!canShowRecent) {
      setRecentOpen(false);
      return;
    }
    setRecentActiveIndex(0);
    if (document.activeElement === inputRef.current) {
      setRecentOpen(true);
    }
  }, [canShowRecent, recentScenes]);

  const recallRecent = (sceneId: string) => {
    onRecallRecentScene?.(sceneId);
    setRecentOpen(false);
    inputRef.current?.blur();
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement | HTMLButtonElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && shellRef.current?.contains(nextTarget)) return;
    setRecentOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!canShowRecent) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setRecentOpen(true);
      setRecentActiveIndex((current) => (current + 1) % recentScenes.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setRecentOpen(true);
      setRecentActiveIndex((current) => (current - 1 + recentScenes.length) % recentScenes.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = recentScenes[recentActiveIndex] ?? recentScenes[0];
      if (target) recallRecent(target.id);
      return;
    }
    if (event.key === "Escape" && recentOpen) {
      event.preventDefault();
      setRecentOpen(false);
    }
  };

  return (
    <div className={styles.search} ref={shellRef} data-toolbar-primary="search" data-testid="lighting-search">
      <input
        ref={inputRef}
        aria-label="Search fixtures, scenes and groups"
        aria-controls={recentOpen ? "lighting-search-recents" : undefined}
        aria-expanded={recentOpen || undefined}
        aria-haspopup="listbox"
        className={styles.input}
        data-well=""
        onBlur={handleBlur}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
        onFocus={() => {
          if (canShowRecent) setRecentOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search fixtures, scenes and groups"
        type="search"
        value={searchQuery}
      />
      {recentOpen && canShowRecent ? (
        <div
          className={styles.recents}
          data-level="float"
          data-material="plate"
          id="lighting-search-recents"
          role="listbox"
          aria-label="Recent scenes"
        >
          <span className={styles.recentsHead}>Recent</span>
          {recentScenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              role="option"
              aria-selected={index === recentActiveIndex}
              className={styles.recentOption}
              onBlur={handleBlur}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setRecentActiveIndex(index)}
              onClick={() => recallRecent(scene.id)}
            >
              <span className={styles.recentName}>{scene.name}</span>
              {scene.lastRecalledLabel ? <span className={styles.recentMeta}>{scene.lastRecalledLabel}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
