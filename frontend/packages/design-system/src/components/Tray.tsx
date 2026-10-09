import type { CSSProperties, ReactNode } from "react";

import styles from "./Tray.module.css";

// The Overview (D47; docs/design/overview-3.md §1): keys that belong
// together, set into one recess. A tray is a step darker than the room (the
// room's floor tone, or the page's floor outside a room) with a soft inner
// edge, never a shadow cast outwards: 12 outside, the keys 8 inside, 4
// between them. It lays its keys in a row 4 px apart; a page that wants a grid
// (PLAY beside BACK and TOP) passes its own class.
export interface TrayProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export function Tray({ children, className, style, testId }: TrayProps) {
  return (
    <div className={[styles.tray, className].filter(Boolean).join(" ")} style={style} data-tray="" data-testid={testId}>
      {children}
    </div>
  );
}
