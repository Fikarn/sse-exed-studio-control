import { Button, Dialog } from "@sse/design-system";

import styles from "./KeyboardShortcutsPopover.module.css";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

const SHORTCUTS: ReadonlyArray<{ heading: string; entries: ReadonlyArray<ShortcutEntry> }> = [
  {
    heading: "Scenes",
    entries: [
      { keys: ["S"], description: "Save current rig state as a new scene" },
    ],
  },
  {
    heading: "Patch",
    entries: [{ keys: ["P"], description: "Toggle patch mode" }],
  },
  {
    heading: "Selection",
    entries: [
      { keys: ["Esc"], description: "Clear selection" },
      { keys: ["Shift", "Click"], description: "Add fixture to selection (multi-select)" },
    ],
  },
  {
    heading: "Edit",
    entries: [
      { keys: ["⌘", "Z"], description: "Undo last fixture create / delete" },
      { keys: ["⌘", "⇧", "Z"], description: "Redo" },
    ],
  },
  {
    heading: "Stage plot",
    entries: [
      { keys: ["←", "→", "↑", "↓"], description: "Nudge selected fixture by 0.1 m" },
      { keys: ["⇧", "←", "→", "↑", "↓"], description: "Nudge selected fixture by 0.5 m" },
      { keys: ["Wheel"], description: "Zoom · drag to pan · double-click to reset" },
      { keys: ["⌥", "Drag"], description: "Drop a fixture without 0.5 m snap" },
    ],
  },
  {
    heading: "Monitor",
    entries: [{ keys: ["⌘", "⇧", "M"], description: "Open the full DMX monitor" }],
  },
];

export interface KeyboardShortcutsPopoverProps {
  onClose: () => void;
}

export function KeyboardShortcutsPopover({ onClose }: KeyboardShortcutsPopoverProps) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      onClose={onClose}
      actions={
        <Button onClick={onClose} variant="ghost" size="compact">
          Close
        </Button>
      }
    >
      <div className={styles.shell}>
        {SHORTCUTS.map((group) => (
          <section key={group.heading} className={styles.group}>
            <h3 className={styles.groupHeading}>{group.heading}</h3>
            <ul className={styles.list}>
              {group.entries.map((entry, index) => (
                <li key={`${group.heading}-${index}`} className={styles.row}>
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
        ))}
        <p className={styles.footnote}>On Windows, Ctrl substitutes for ⌘.</p>
      </div>
    </Dialog>
  );
}
