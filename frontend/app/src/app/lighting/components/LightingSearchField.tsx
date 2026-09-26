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
// list, moved into the cluster. In the field, the arrows walk the Recent list
// (opening it), Enter recalls the scene lit in it, and Esc closes it: a focused
// list, kept under D6. New pages program, Slice 3 (decision 11): Enter recalls
// a scene only while the Recent list is open — with the list closed it used to
// recall the most recent scene live, with nothing on screen to say so.

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
  // The list's content, scene by scene. Every lighting refresh hands the field
  // a new array of the same scenes; that is not a change, so it neither
  // re-opens a list Esc closed nor moves the lit row (decision 11: Enter
  // recalls only while the list is open, so the list stays as the operator
  // left it).
  const recentKey = recentScenes.map((scene) => scene.id).join("\n");

  useEffect(() => {
    if (!canShowRecent) {
      setRecentOpen(false);
      return;
    }
    setRecentActiveIndex(0);
    if (document.activeElement === inputRef.current) {
      setRecentOpen(true);
    }
  }, [canShowRecent, recentKey]);

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
      if (!recentOpen) return;
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
