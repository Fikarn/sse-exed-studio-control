import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Ellipsis } from "lucide-react";

import type { Placement } from "./anchoredPosition";
import { IconButton, type IconButtonSize } from "./IconButton";
import { Menu, type MenuCloseReason, type MenuProps } from "./Menu";
import type { FloatingAnchor } from "./useFloatingLayer";

// Visual overhaul B (DESIGN.md §9): the ⋯ key on an object, and the same menu
// at the pointer when the object is right-clicked. Nothing is right-click
// only: every object that has a context menu shows this key (on hover and
// while selected, where the page says so), and both open one menu.

export type MenuContent = Omit<
  MenuProps,
  "open" | "anchor" | "onClose" | "returnFocusTo" | "ignoreOutside" | "initialFocus" | "placement" | "id"
>;

export interface MenuButtonProps {
  /** The key's accessible name, naming the object: "Host menu". */
  buttonLabel: string;
  menu: MenuContent;
  /** A right-click on this element opens the same menu at the pointer. */
  contextTarget?: RefObject<HTMLElement | null>;
  /** Default `bottom-end`: a ⋯ sits at its object's right, so its menu hangs inward. */
  placement?: Placement;
  size?: IconButtonSize;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  buttonTestId?: string;
}

export function MenuButton({
  buttonLabel,
  menu,
  contextTarget,
  placement = "bottom-end",
  size = "md",
  onOpenChange,
  disabled,
  className,
  buttonTestId,
}: MenuButtonProps) {
  const menuId = `menu-${useId()}`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<{ anchor: FloatingAnchor; fromKeyboard: boolean } | null>(null);
  const open = state !== null;

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpenState = useCallback((next: { anchor: FloatingAnchor; fromKeyboard: boolean } | null) => {
    setState((previous) => {
      if ((previous === null) !== (next === null)) onOpenChangeRef.current?.(next !== null);
      return next;
    });
  }, []);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpenState(null);
      return;
    }
    // A key pressed from the keyboard clicks with no pointer detail: the menu
    // then puts the focus on its first item.
    setOpenState({ anchor: event.currentTarget, fromKeyboard: event.detail === 0 });
  };

  useEffect(() => {
    const target = contextTarget?.current;
    if (!target || disabled) return undefined;
    const onContextMenu = (event: globalThis.MouseEvent) => {
      // An object inside this one (a fixture on the stage) opened its own menu.
      if (event.defaultPrevented) return;
      event.preventDefault();
      setOpenState({ anchor: { x: event.clientX, y: event.clientY }, fromKeyboard: false });
    };
    target.addEventListener("contextmenu", onContextMenu);
    return () => target.removeEventListener("contextmenu", onContextMenu);
  }, [contextTarget, disabled, setOpenState]);

  const onClose = useCallback(
    (_reason: MenuCloseReason) => {
      setOpenState(null);
    },
    [setOpenState]
  );

  const fromPointer = state !== null && !(state.anchor instanceof HTMLElement);

  return (
    <>
      <IconButton
        ref={buttonRef}
        icon={Ellipsis}
        label={buttonLabel}
        size={size}
        tone="default"
        className={className}
        disabled={disabled}
        title={undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-menu-button=""
        data-open={open ? "" : undefined}
        data-testid={buttonTestId}
        onClick={onClick}
      />
      <Menu
        {...menu}
        id={menuId}
        open={open}
        anchor={state?.anchor ?? null}
        placement={fromPointer ? "bottom-start" : placement}
        onClose={onClose}
        initialFocus={state?.fromKeyboard ? "first" : "menu"}
        returnFocusTo={fromPointer ? undefined : buttonRef.current}
        ignoreOutside={[buttonRef]}
      />
    </>
  );
}
