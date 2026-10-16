import { useId, type CSSProperties, type MouseEventHandler, type ReactNode, type Ref } from "react";

import styles from "./SessionRoom.module.css";

// The Session page (D51; docs/design/session.md, board 2): a Room is the
// brand's own device (Brand Guidelines p.41), a one-point-perspective space
// whose every horizontal stays level: a back wall, a ceiling with a skylight,
// a lit and a shaded side wall and the floor, in one hue in the brand's
// shading, with the Grain and Watercolour textures drawn by SVG filters. It
// holds the program's own drawing of the studio as one kind of session uses
// it (SessionRoomDrawings.tsx), and its name and line stand on its floor, as
// the brand's posters set theirs.
//
// On the page the whole Room is the key that opens its window. In the window
// it is the window's picture, drawn at its own size with its own type steps
// (20 and 14), never a scaled 28: only the travel between the two is a
// transform (Sheet.tsx). The name and the line are text over the picture, so
// the page tests measure them; the Room is not a `data-picture`.
//
// The light: under the pointer, on a Room whose session runs (`lit`) and in
// the window, the skylight's glow brightens on the back wall and the
// drawing's own lights come on. Only opacity and the edge change; nothing
// moves.
export type SessionRoomTone = "green" | "umber" | "slate";

export interface SessionRoomProps {
  tone: SessionRoomTone;
  /** The kind's name, printed in SSE Adelia capitals (`Podcast Recording`). */
  name: string;
  /** Its line, in PT Serif italic (`Voices around the table, a camera on each.`). */
  line: string;
  /** Replaces the line on the page: the running session's `● In session · since 09:16`. */
  caption?: ReactNode;
  /** The light stays on: the Room of the session that runs. */
  lit?: boolean;
  /**
   * `page` (600 × 880, the key) or `window` (423 × 620, the window's picture:
   * not a key, its light always on, its line always the line).
   */
  size?: "page" | "window";
  /** While its window is open the Room stands empty, its picture in the window. */
  away?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** The Room's key on the page (the window opens from it and gives the focus back to it). */
  ref?: Ref<HTMLButtonElement>;
  /** The drawing: an SVG group in the Room's 600 × 880 frame. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

/** The Room's frame: every drawing is drawn in it, at either size. */
const FRAME = { width: 600, height: 880 } as const;

// The watercolour's seed, per tone: board 2's.
const MOTTLE_SEED: Record<SessionRoomTone, number> = { green: 35, umber: 49, slate: 49 };

export function SessionRoom({
  tone,
  name,
  line,
  caption,
  lit = false,
  size = "page",
  away = false,
  onClick,
  disabled,
  ref,
  children,
  className,
  style,
  testId,
}: SessionRoomProps) {
  // `url(#…)` takes the id as it is: keep it to the characters every reader accepts.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const grain = `${id}-grain`;
  const mottle = `${id}-mottle`;
  const sky = `${id}-sky`;
  const art = (
    <>
      <svg
        className={styles.art}
        viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter id={grain} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={4} />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0" />
          </filter>
          <filter id={mottle} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves={3} seed={MOTTLE_SEED[tone]} />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.32 -0.06" />
          </filter>
          <radialGradient id={sky} cx="300" cy="96" r="420" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopOpacity="0.2" data-stop="sky" />
            <stop offset="0.55" stopOpacity="0.05" data-stop="sky" />
            <stop offset="1" stopOpacity="0" data-stop="sky" />
          </radialGradient>
        </defs>
        {/* The planes: every horizontal level, the side walls and the floor
            running out to the frame's corners. */}
        <path data-plane="ceil" d="M0 0 H600 L510 100 H90 Z" />
        <path data-plane="lit" d="M0 0 L90 100 V590 L0 880 Z" />
        <path data-plane="shade" d="M600 0 V880 L510 590 V100 Z" />
        <path data-plane="floor" d="M90 590 H510 L600 880 H0 Z" />
        <rect data-plane="back" x="90" y="100" width="420" height="490" />
        {/* The textures: a watercolour mottle on the back wall, a fine grain
            over everything. The grain is noise, pixel by pixel, which no
            capture stores small: the page tests' captures leave it out
            (`data-texture`, tests/helpers/captures.css); the measures read it. */}
        <rect data-texture="watercolour" x="90" y="100" width="420" height="490" filter={`url(#${mottle})`} />
        <rect data-texture="grain" x="0" y="0" width="600" height="880" filter={`url(#${grain})`} />
        {/* The edges where the planes meet, very quiet. */}
        <path data-edge="" d="M0 0 L90 100 M600 0 L510 100 M0 880 L90 590 M600 880 L510 590 M90 100 H510 V590 H90 Z" />
        {/* The skylight, and its light on the back wall. */}
        <path
          data-skylight="pane"
          d="M222 16 H378 L364 76 H236 Z"
          fillOpacity="0.1"
          strokeOpacity="0.35"
          strokeWidth="1.4"
        />
        <path data-skylight="bars" d="M274 16 L270 76 M326 16 L330 76" strokeOpacity="0.3" strokeWidth="1.2" />
        <rect data-light="sky" x="90" y="100" width="420" height="490" fill={`url(#${sky})`} />
        {children}
      </svg>
      <span className={styles.name}>{name}</span>
      {caption && size === "page" ? (
        <span className={styles.caption}>{caption}</span>
      ) : (
        <span className={styles.line}>{line}</span>
      )}
    </>
  );
  const classes = [styles.room, styles[tone], size === "window" ? styles.window : styles.page, className]
    .filter(Boolean)
    .join(" ");
  if (size === "window") {
    return (
      <div className={classes} style={style} data-session-room={tone} data-size="window" data-testid={testId}>
        {art}
      </div>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      style={style}
      data-session-room={tone}
      data-size="page"
      data-lit={lit ? "" : undefined}
      data-away={away ? "" : undefined}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {art}
    </button>
  );
}
