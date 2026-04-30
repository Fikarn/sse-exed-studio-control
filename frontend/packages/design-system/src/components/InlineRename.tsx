import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import styles from "./InlineRename.module.css";

export interface InlineRenameProps {
  /** Current display value. When this changes externally and the user is not
   *  editing, the draft resets so the parent stays in control. */
  value: string;
  /** Called with the trimmed value when the user commits. Empty submissions
   *  are blocked client-side and revert to the prior value. May be async — the
   *  caller controls the busy flag separately. */
  onCommit: (next: string) => void | Promise<void>;
  /** Class applied to both the display span and the input so swap doesn't
   *  shift layout. Should set font / color / max-width to taste. */
  className?: string;
  /** aria-label applied to the input when editing. */
  inputAriaLabel?: string;
  /** Skips the edit handlers entirely. Display-only. */
  disabled?: boolean;
  /** Visual busy state while a parent commit is pending. */
  busy?: boolean;
  /** Optional max length on the input. */
  maxLength?: number;
  /** Placeholder when the input would be empty. */
  placeholder?: string;
  /** Fires when the editor opens. Useful for parents that need to suppress
   *  sibling drag-listeners or similar. */
  onEditStart?: () => void;
  /** Fires when the editor closes (commit, cancel, or blur). */
  onEditEnd?: () => void;
}

export interface InlineRenameHandle {
  /** Open the editor programmatically. Used by external pencil buttons or
   *  keyboard shortcuts (F2). No-op while disabled or already editing. */
  beginEdit: () => void;
}

/**
 * Linear / Notion / Figma-style inline rename. Renders a span by default;
 * double-click swaps in an `<input>` that commits on Enter or blur, reverts on
 * Escape, and rejects empty submissions. Keep the surrounding click target
 * (e.g. SceneTile) — click events from the display span pass through. The
 * input itself stops propagation so typing doesn't trigger sibling actions.
 */
export const InlineRename = forwardRef<InlineRenameHandle, InlineRenameProps>(function InlineRename(
  {
    value,
    onCommit,
    className,
    inputAriaLabel,
    disabled = false,
    busy = false,
    maxLength,
    placeholder,
    onEditStart,
    onEditEnd,
  },
  ref
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset draft when the upstream value changes and we're not editing.
  // While editing the user owns the value, so don't clobber.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  // Auto-focus + select the input on edit-mode entry so the typical rename
  // gesture (double-click → type new name) works without a separate select-all.
  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const beginEdit = useCallback(() => {
    if (disabled || editing || busy) return;
    setDraft(value);
    setEditing(true);
    onEditStart?.();
  }, [busy, disabled, editing, onEditStart, value]);

  useImperativeHandle(ref, () => ({ beginEdit }), [beginEdit]);

  const finishEdit = useCallback(
    (commit: boolean) => {
      const trimmed = draft.trim();
      const shouldCommit = commit && trimmed.length > 0 && trimmed !== value;
      setEditing(false);
      onEditEnd?.();
      // Reset draft to the canonical value if we're not committing — the next
      // render's useEffect would do this anyway, but resetting synchronously
      // avoids a one-frame flash of the rejected text.
      if (!shouldCommit) {
        setDraft(value);
        return;
      }
      void onCommit(trimmed);
    },
    [draft, onCommit, onEditEnd, value]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finishEdit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishEdit(false);
    }
  };

  const handleDoubleClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (disabled || busy) return;
    event.stopPropagation();
    beginEdit();
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={[styles.input, className].filter(Boolean).join(" ")}
        type="text"
        value={draft}
        aria-label={inputAriaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={busy}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => finishEdit(true)}
        // Stop bubbling so clicks/pointerdowns inside the input never reach a
        // wrapping clickable surface (e.g. the SceneTile recall handler).
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      />
    );
  }

  // Display mode. Click events pass through so the wrapping element retains
  // its click semantics (SceneTile recall, inspector tab focus, etc.); only
  // double-clicks are intercepted to enter edit mode.
  const displayStyle: CSSProperties | undefined = busy ? { opacity: 0.6 } : undefined;
  return (
    <span
      data-inline-rename="display"
      className={[styles.display, disabled ? styles.displayDisabled : "", className].filter(Boolean).join(" ")}
      onDoubleClick={handleDoubleClick}
      style={displayStyle}
      title={disabled ? undefined : "Double-click to rename"}
    >
      {value}
    </span>
  );
});
