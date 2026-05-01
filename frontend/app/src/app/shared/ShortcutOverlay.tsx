import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

import styles from "./ShortcutOverlay.module.css";

interface ShortcutEntry {
  keys: readonly string[];
  description: string;
}

interface ShortcutSection {
  heading: string;
  entries: readonly ShortcutEntry[];
}

// Static shortcut catalogue. New shortcuts added to the app should land here
// so the `?` overlay stays comprehensive. Sections grouped by surface; the
// search field substring-matches across every entry's description + keys.
const SHORTCUTS: readonly ShortcutSection[] = [
  {
    heading: "Shell",
    entries: [
      { keys: ["⌘", "K"], description: "Open command palette (Ctrl+K on Windows)" },
      { keys: ["?"], description: "Toggle this shortcuts overlay" },
      { keys: ["Esc"], description: "Close current overlay / clear selection" },
      { keys: ["⌘/Ctrl", "1–4"], description: "Switch workspaces (Setup, Lighting, Audio, Planning)" },
      { keys: ["Shift", "S"], description: "Open Setup / Support" },
      { keys: ["A"], description: "Open Audio workspace" },
      { keys: ["⌘/Ctrl", "Shift", "R"], description: "Restart the engine bridge" },
    ],
  },
  {
    heading: "Lighting · scenes",
    entries: [
      {
        keys: ["S"],
        description: "Smart save — save changes if active scene is drifted, else create a new scene",
      },
      { keys: ["⌘", "S"], description: "Save changes to the active scene (no-op if no drift)" },
      { keys: ["⌘", "Shift", "S"], description: "Save as new scene (opens a name dialog)" },
      { keys: ["1–9"], description: "Recall scene 1–9 (numbered slots)" },
    ],
  },
  {
    heading: "Lighting · selection + edit",
    entries: [
      { keys: ["Esc"], description: "Clear fixture selection (also clears Highlight / Solo / Find)" },
      { keys: ["Shift", "Click"], description: "Add fixture to selection (multi-select)" },
      { keys: ["⌘", "A"], description: "Select all fixtures" },
      { keys: ["⌘", "F"], description: "Focus toolbar search" },
      { keys: ["⌘", "Z"], description: "Undo last fixture create / delete" },
      { keys: ["⌘", "Shift", "Z"], description: "Redo" },
      { keys: ["F2"], description: "Rename focused scene tile (inline)" },
      { keys: ["H"], description: "Toggle Highlight on the current selection" },
      { keys: ["Shift", "H"], description: "Toggle Solo on the current selection (dim everything else)" },
      { keys: ["Shift", "I"], description: "Find — pulse the selection in turn so you can locate each fixture" },
    ],
  },
  {
    heading: "Lighting · patch",
    entries: [{ keys: ["P"], description: "Toggle patch mode" }],
  },
  {
    heading: "Lighting · stage plot",
    entries: [
      { keys: ["←", "→", "↑", "↓"], description: "Nudge selected fixture by 0.1 m" },
      { keys: ["Shift", "←", "→", "↑", "↓"], description: "Nudge selected fixture by 0.5 m" },
      { keys: ["Wheel"], description: "Zoom · drag to pan (middle mouse) · double-click to reset" },
      { keys: ["Drag"], description: "Marquee-select fixtures (Shift+drag adds to selection)" },
      { keys: ["⌥", "Drag"], description: "Drop a fixture without 0.5 m snap (free positioning)" },
    ],
  },
  {
    heading: "Lighting · sliders",
    entries: [
      { keys: ["Shift", "Drag"], description: "Fine adjust (×0.1) on intensity / CCT / scrub-labels" },
      { keys: ["⌘", "Drag"], description: "Coarse adjust (×10) on intensity / CCT / scrub-labels" },
      { keys: ["Double-click"], description: "Reset slider to its default value" },
    ],
  },
  {
    heading: "Lighting · monitor",
    entries: [{ keys: ["⌘", "Shift", "M"], description: "Open the full DMX monitor" }],
  },
  {
    heading: "Audio",
    entries: [
      { keys: ["[", "]"], description: "Page through fader banks" },
      { keys: ["1–8"], description: "Select a strip in the active bank" },
      { keys: ["Shift", "1–8"], description: "Recall an audio snapshot" },
      { keys: ["←", "→"], description: "Move between mix targets" },
      { keys: ["M", "S"], description: "Mute / solo the selected strip" },
      { keys: ["V"], description: "Cycle Audio density (compact / regular / spacious)" },
    ],
  },
  {
    heading: "Planning",
    entries: [
      { keys: ["Shift", "B"], description: "Toggle Board view" },
      { keys: ["Shift", "T"], description: "Toggle Timeline view" },
      { keys: ["[", "]"], description: "Move the time window" },
      { keys: ["0"], description: "Snap timeline view back to now" },
      { keys: ["Shift", "[", "]"], description: "Change the Planning day" },
      { keys: ["Shift", "←", "→"], description: "Nudge the selected schedule block" },
      { keys: ["0–4"], description: "Filter Planning board columns" },
    ],
  },
  {
    heading: "Setup · runner",
    entries: [
      { keys: ["Tab"], description: "Move forward through runner steps" },
      { keys: ["Shift", "Tab"], description: "Move back through runner steps" },
      { keys: ["Enter"], description: "Invoke the runner footer primary action" },
      { keys: ["J", "K"], description: "Move through binding details in Map and Verify" },
      { keys: ["1–4"], description: "Jump to a page in the Setup Map" },
    ],
  },
];

function matches(query: string, section: ShortcutSection, entry: ShortcutEntry): boolean {
  if (!query) return true;
  const haystack = `${section.heading} ${entry.description} ${entry.keys.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export interface ShortcutOverlayProps {
  onClose: () => void;
}

/**
 * Searchable, `?`-bound keyboard shortcuts overlay (Linear pattern). Renders
 * a centered modal via portal at document.body. Search box auto-focused;
 * substring-filters across every entry's description + keys live as the
 * operator types. Esc / `?` / backdrop click / Close button all dismiss.
 *
 * Sections cover every workspace (Shell, Lighting, Audio, Planning, Setup)
 * so the operator can browse cross-workspace shortcuts without switching
 * away from their current view.
 */
export function ShortcutOverlay({ onClose }: ShortcutOverlayProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const filtered = useMemo(() => {
    return SHORTCUTS.map((section) => ({
      heading: section.heading,
      entries: section.entries.filter((entry) => matches(query, section, entry)),
    })).filter((section) => section.entries.length > 0);
  }, [query]);

  const totalEntries = filtered.reduce((sum, s) => sum + s.entries.length, 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <span id={`${inputId}-title`} className={styles.title}>
            Keyboard shortcuts
          </span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close shortcuts overlay">
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <label className={styles.search} htmlFor={inputId}>
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            placeholder="Filter shortcuts — try: scene, recall, save, monitor"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className={styles.body}>
          {totalEntries === 0 ? (
            <div className={styles.empty}>No shortcuts match “{query}”.</div>
          ) : (
            filtered.map((section) => (
              <section key={section.heading} className={styles.section}>
                <h3 className={styles.heading}>{section.heading}</h3>
                <ul className={styles.list}>
                  {section.entries.map((entry, index) => (
                    <li key={`${section.heading}-${index}`} className={styles.row}>
                      <span className={styles.keys}>
                        {entry.keys.map((key, keyIndex) => (
                          <kbd key={keyIndex} className={styles.kbd}>
                            {key}
                          </kbd>
                        ))}
                      </span>
                      <span className={styles.description}>{entry.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className={styles.footer}>On Windows, Ctrl substitutes for ⌘.</div>
      </div>
    </div>,
    document.body
  );
}
