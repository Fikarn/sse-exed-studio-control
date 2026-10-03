import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type { Placement } from "./anchoredPosition";
import styles from "./Menu.module.css";
import { useArm, type UseArmResult } from "./useArm";
import { useDismissOnOutside, useFloatingPosition, useReturnFocus, type FloatingAnchor } from "./useFloatingLayer";

// Visual overhaul B (DESIGN.md §9): the one menu. Every object's ⋯ opens it,
// and a right-click on the object opens the same menu at the pointer. Its head
// names the object; its items say their current value in words at the right;
// a disabled item says why; the destructive item sits last, in coral, and arms
// in place: the first press turns it into the one armed form (Burgundy, "press
// again", a countdown bar) while the menu stays open, the second does it.
//
// Esc, in order: a menu with an armed item disarms it and stays open; the next
// Esc closes the menu and gives the focus back to what opened it. The menu
// keeps its Esc to itself, so a page's armed key or a dialog under the menu is
// left for the Esc after.

/** A command. `value` is its current value in words, at the right ("−3.8 dB"). */
export interface MenuActionItem {
  kind?: "action";
  id: string;
  label: string;
  value?: string;
  onSelect: () => void;
  /** Disables the item; the words say why, at the right ("no clip held"). */
  disabledReason?: string | null;
  /**
   * Coral: a destructive command whose own dialog confirms it ("Delete
   * scene…"). The right-click menus of before keep it until their page moves
   * it to `destructive`, the item that arms in place.
   */
  tone?: "danger";
  testId?: string;
}

/** A toggle. It states its value in words at the right: "on" / "off" unless named. */
export interface MenuCheckItem {
  kind: "check";
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onWord?: string;
  offWord?: string;
  disabledReason?: string | null;
  testId?: string;
}

/** One choice of several, under a group label; the chosen one carries a mark. */
export interface MenuRadioItem {
  kind: "radio";
  id: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
  value?: string;
  disabledReason?: string | null;
  testId?: string;
}

/** The quiet label over a group of choices ("Show", "Frame"). */
export interface MenuGroupLabel {
  kind: "label";
  id: string;
  label: string;
}

export interface MenuDivider {
  kind: "divider";
  id?: string;
}

export type MenuEntry = MenuActionItem | MenuCheckItem | MenuRadioItem | MenuGroupLabel | MenuDivider;

/** The destructive item: always last, after a divider, coral; it arms in place. */
export interface MenuDestructiveItem {
  id: string;
  /** At rest, a command that ends in "…" ("Turn 48 V off…"). */
  label: string;
  /** Armed ("Press again to turn 48 V off"). */
  armedLabel?: string;
  onConfirm: () => void;
  disabledReason?: string | null;
  /** This item's own arm window, where it differs from the surface's. */
  windowMs?: number;
  testId?: string;
}

export interface MenuHead {
  /** The object's name, as the page prints it (it keeps its case). */
  title: string;
  /** A quiet sub-line ("Preamp 1 · mic"). */
  detail?: string;
}

export type MenuCloseReason = "select" | "escape" | "outside" | "scroll" | "tab";

export interface MenuProps {
  open: boolean;
  /** The element the menu hangs from (its ⋯), or the pointer of a right-click. */
  anchor: FloatingAnchor;
  onClose: (reason: MenuCloseReason) => void;
  head?: MenuHead;
  items: readonly MenuEntry[];
  destructive?: MenuDestructiveItem;
  /** The menu's accessible name when there is no head. */
  label?: string;
  /** Default `bottom-start`; at the pointer it opens down and right of it. */
  placement?: Placement;
  /**
   * The surface's arm state, so arming here disarms any other armed key and
   * the other way round. Without it the menu keeps its own.
   */
  arm?: UseArmResult;
  /** Where the focus goes when the menu closes; default what had it on open. */
  returnFocusTo?: HTMLElement | null;
  /** Elements whose presses do not count as outside (the key that toggles it). */
  ignoreOutside?: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** `first` puts the focus on the first item (opened from the keyboard). */
  initialFocus?: "first" | "menu";
  /**
   * A still countdown for a board: the armed item's bar is drawn at this
   * fraction of its window and does not run (as StateDisplay's armed row).
   */
  armedProgress?: number;
  id?: string;
  testId?: string;
  className?: string;
}

type FocusableEntry = MenuActionItem | MenuCheckItem | MenuRadioItem | (MenuDestructiveItem & { kind: "destructive" });

function isFocusable(entry: MenuEntry): entry is MenuActionItem | MenuCheckItem | MenuRadioItem {
  return entry.kind !== "divider" && entry.kind !== "label";
}

function isDisabled(entry: { disabledReason?: string | null }): boolean {
  return entry.disabledReason !== undefined && entry.disabledReason !== null;
}

/** Splits the entries at dividers; a section that starts with a label is a group. */
function sectionsOf(items: readonly MenuEntry[]): MenuEntry[][] {
  const sections: MenuEntry[][] = [[]];
  for (const entry of items) {
    if (entry.kind === "divider") {
      if (sections[sections.length - 1]!.length > 0) sections.push([]);
      continue;
    }
    if (entry.kind === "label" && sections[sections.length - 1]!.length > 0) sections.push([]);
    sections[sections.length - 1]!.push(entry);
  }
  return sections.filter((section) => section.length > 0);
}

function itemElement(list: HTMLElement | null, entryId: string): HTMLElement | null {
  if (!list) return null;
  return (
    Array.from(list.querySelectorAll<HTMLElement>("[data-menu-item]")).find(
      (element) => element.dataset.menuItem === entryId
    ) ?? null
  );
}

const CHECK_MARK = (
  <svg className={styles.markIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

export function Menu({
  open,
  anchor,
  onClose,
  head,
  items,
  destructive,
  label,
  placement = "bottom-start",
  arm: sharedArm,
  returnFocusTo,
  ignoreOutside,
  initialFocus = "menu",
  armedProgress,
  id,
  testId,
  className,
}: MenuProps) {
  const ownArm = useArm();
  const arm = sharedArm ?? ownArm;
  const autoId = useId();
  const menuId = id ?? `menu-${autoId}`;
  const headId = `${menuId}-head`;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const isPointer = anchor !== null && !(anchor instanceof HTMLElement);

  const focusables = useMemo<FocusableEntry[]>(() => {
    const list: FocusableEntry[] = items.filter(isFocusable);
    if (destructive) list.push({ ...destructive, kind: "destructive" });
    return list;
  }, [items, destructive]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const armKey = destructive ? `menu:${destructive.id}` : null;
  const armed = armKey !== null && arm.armed?.key === armKey;

  const position = useFloatingPosition(layerRef, anchor, placement, {
    offset: isPointer ? 2 : 4,
    open,
    deps: [items, destructive?.id, head?.title, head?.detail],
  });
  useReturnFocus(layerRef, open, returnFocusTo);

  const close = useCallback(
    (reason: MenuCloseReason) => {
      if (armKey && arm.armed?.key === armKey) arm.cancel();
      onClose(reason);
    },
    [arm, armKey, onClose]
  );
  useDismissOnOutside(layerRef, (reason) => close(reason), { open, ignore: ignoreOutside });

  // A menu that closes, or goes away, while its item is armed leaves nothing armed.
  const armRef = useRef(arm);
  armRef.current = arm;
  useEffect(() => {
    if (!open || !armKey) return undefined;
    return () => {
      if (armRef.current.armed?.key === armKey) armRef.current.cancel();
    };
  }, [open, armKey]);

  // The focus goes into the menu once it is placed: onto the first item when
  // opened from the keyboard, onto the menu itself when opened by the pointer.
  useEffect(() => {
    if (!open || !position.ready) return;
    if (initialFocus === "first") {
      const first = focusables.find((entry) => !isDisabled(entry));
      if (first) {
        setActiveId(first.id);
        itemElement(listRef.current, first.id)?.focus();
        return;
      }
    }
    listRef.current?.focus();
    // Only when the menu opens and is placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position.ready]);

  useEffect(() => {
    if (!open) setActiveId(null);
  }, [open]);

  const focusEntry = useCallback(
    (entryId: string) => {
      setActiveId(entryId);
      // Moving off the armed item disarms it.
      if (destructive && entryId !== destructive.id && armKey && arm.armed?.key === armKey) arm.cancel();
      itemElement(listRef.current, entryId)?.focus();
    },
    [arm, armKey, destructive]
  );

  // The arrows pass over a disabled item; its reason is read with its words.
  const enabled = useMemo(() => focusables.filter((entry) => !isDisabled(entry)), [focusables]);
  const step = useCallback(
    (delta: 1 | -1) => {
      if (enabled.length === 0) return;
      const current = enabled.findIndex((entry) => entry.id === activeId);
      const start = current === -1 ? (delta === 1 ? -1 : 0) : current;
      const next = enabled[(start + delta + enabled.length) % enabled.length]!;
      focusEntry(next.id);
    },
    [activeId, enabled, focusEntry]
  );

  const activate = useCallback(
    (entry: FocusableEntry) => {
      if (isDisabled(entry)) return;
      switch (entry.kind) {
        case "destructive":
          arm.armOrApply(
            armKey!,
            entry.label,
            () => {
              onClose("select");
              entry.onConfirm();
            },
            entry.windowMs
          );
          return;
        case "check":
          onClose("select");
          entry.onCheckedChange(!entry.checked);
          return;
        default:
          onClose("select");
          entry.onSelect();
      }
    },
    [arm, armKey, onClose]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        step(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Home":
      case "End": {
        event.preventDefault();
        event.stopPropagation();
        const ends = event.key === "Home" ? enabled : [...enabled].reverse();
        if (ends[0]) focusEntry(ends[0].id);
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        event.stopPropagation();
        // A held Enter repeats; a repeat never presses an item, so a held key
        // never confirms an armed one.
        if (event.repeat) return;
        const entry = focusables.find((candidate) => candidate.id === activeId);
        if (entry) activate(entry);
        return;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (armed) {
          arm.cancel();
          return;
        }
        close("escape");
        return;
      case "Tab":
        // Tab leaves the menu as it leaves any list; the focus goes back to
        // what opened the menu and Tab moves on from there.
        close("tab");
        return;
      default:
        return;
    }
  };

  if (!open || typeof document === "undefined") return null;

  const renderItem = (entry: FocusableEntry): ReactNode => {
    const disabled = isDisabled(entry);
    const active = entry.id === activeId;
    const common = {
      type: "button" as const,
      "data-menu-item": entry.id,
      "data-testid": entry.testId,
      "data-active": active ? "" : undefined,
      "aria-disabled": disabled ? true : undefined,
      tabIndex: active ? 0 : -1,
      onPointerEnter: () => focusEntry(entry.id),
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        activate(entry);
      },
    };
    if (entry.kind === "destructive") {
      const windowMs = entry.windowMs ?? arm.armed?.timeoutMs ?? 4500;
      return (
        <button
          key={entry.id}
          {...common}
          role="menuitem"
          className={[styles.item, styles.destructive, armed ? styles.armed : ""].filter(Boolean).join(" ")}
          data-armed={armed ? "true" : "false"}
        >
          <span className={styles.label}>{armed ? (entry.armedLabel ?? "Press again") : entry.label}</span>
          {disabled && entry.disabledReason ? <span className={styles.value}>{entry.disabledReason}</span> : null}
          {armed ? (
            <span
              key={arm.armed?.armedAt}
              aria-hidden="true"
              className={styles.countdown}
              data-testid={entry.testId ? `${entry.testId}-countdown` : undefined}
              data-still={armedProgress === undefined ? undefined : ""}
              style={
                (armedProgress === undefined
                  ? { "--arm-duration": `${windowMs}ms` }
                  : { transform: `scaleX(${Math.min(1, Math.max(0, armedProgress))})` }) as CSSProperties
              }
            />
          ) : null}
        </button>
      );
    }
    const value =
      disabled && entry.disabledReason
        ? entry.disabledReason
        : entry.kind === "check"
          ? entry.checked
            ? (entry.onWord ?? "on")
            : (entry.offWord ?? "off")
          : entry.value;
    const role = entry.kind === "check" ? "menuitemcheckbox" : entry.kind === "radio" ? "menuitemradio" : "menuitem";
    return (
      <button
        key={entry.id}
        {...common}
        role={role}
        aria-checked={entry.kind === "check" || entry.kind === "radio" ? entry.checked : undefined}
        className={styles.item}
        data-tone={entry.kind === "action" || entry.kind === undefined ? entry.tone : undefined}
      >
        <span className={styles.mark}>{entry.kind === "radio" && entry.checked ? CHECK_MARK : null}</span>
        <span className={styles.label}>{entry.label}</span>
        {value ? <span className={styles.value}>{value}</span> : null}
      </button>
    );
  };

  const sections = sectionsOf(items);
  const hasMarks = items.some((entry) => entry.kind === "radio");

  return createPortal(
    <div
      ref={layerRef}
      className={[styles.layer, className].filter(Boolean).join(" ")}
      data-level="float"
      data-menu=""
      data-marks={hasMarks ? "" : undefined}
      data-placement={position.placement}
      data-testid={testId}
      style={position.style}
      onContextMenu={(event) => {
        // A right-click inside the menu is not a right-click on the page.
        event.preventDefault();
        event.stopPropagation();
      }}
      // The menu is drawn in a portal, but its events still pass up the page's
      // tree: a press in it is not a press on the tile or strip that opened it.
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {head ? (
        <div className={styles.head}>
          <span className={styles.headTitle} id={headId}>
            {head.title}
          </span>
          {head.detail ? (
            <span className={styles.headDetail} id={`${headId}-detail`}>
              {head.detail}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={listRef}
        id={menuId}
        role="menu"
        aria-labelledby={head ? headId : undefined}
        aria-describedby={head?.detail ? `${headId}-detail` : undefined}
        aria-label={head ? undefined : (label ?? "Menu")}
        tabIndex={-1}
        className={styles.list}
        onKeyDown={onKeyDown}
      >
        {sections.map((section, index) => {
          const [first, ...rest] = section;
          const divider = index > 0 ? <div role="separator" className={styles.divider} /> : null;
          if (first?.kind === "label") {
            const groupId = `${menuId}-group-${first.id}`;
            return (
              <div key={first.id} role="none">
                {divider}
                <div role="group" aria-labelledby={groupId}>
                  <div id={groupId} className={styles.groupLabel}>
                    {first.label}
                  </div>
                  {rest.filter(isFocusable).map((entry) => renderItem(entry))}
                </div>
              </div>
            );
          }
          return (
            <div key={(first as { id?: string } | undefined)?.id ?? index} role="none">
              {divider}
              {section.filter(isFocusable).map((entry) => renderItem(entry))}
            </div>
          );
        })}
        {destructive ? (
          <div role="none">
            {sections.length > 0 ? <div role="separator" className={styles.divider} /> : null}
            {renderItem({ ...destructive, kind: "destructive" })}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
