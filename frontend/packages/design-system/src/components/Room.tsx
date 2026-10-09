import { useId, type CSSProperties, type ReactNode } from "react";

import styles from "./Room.module.css";

// The Overview (D47; docs/design/overview-3.md): a room is a raised panel in
// its brand tone, the page's handrail for one job (act, watch, read, listen).
// Its name band (the lintel) runs across the top: the name in SSE Adelia,
// tracked wider than any other Adelia word, the job in the hardware link's
// PT Serif italic, then what the room holds now, and at the right its door to
// the page and its small choices. A floor band closes it where the page asks.
// A page in trouble draws its keyline round its room (`alert`).
//
// Inside, the room re-points the bases the primitives read (the key's face,
// the hairlines, a key's edge) to its own tones, as the operator layout
// re-points the type scale in its scope, so a Key, a Segmented, a list and a
// well's edge take the room's tones with no edit to them, and nothing outside
// a room changes. Its keys are concentric: 8 inside its 12.
export type RoomTone = "stone" | "green" | "slate" | "umber";

export interface RoomProps {
  tone: RoomTone;
  /** The room's name, printed in SSE Adelia capitals (`The take`). */
  name: string;
  /** Its job, one word in PT Serif italic (`act`, `watch`, `read`, `listen`). */
  job: string;
  /** What the room holds now, after the job (PT Sans 14 in the quiet ink;
   *  a name in bold at 16 in the main ink is the page's to pass). */
  facts?: ReactNode;
  /** At the lintel's right: the room's door (`Door`) and small choices. */
  actions?: ReactNode;
  /** The floor band's height in px; none when 0 or absent. */
  floor?: number;
  floorContent?: ReactNode;
  /** The keyline of a page in trouble, round the whole room. */
  alert?: "error" | "attention" | null;
  /** The room's body: the page lays its content inside. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export function Room({
  tone,
  name,
  job,
  facts,
  actions,
  floor,
  floorContent,
  alert,
  children,
  className,
  style,
  testId,
}: RoomProps) {
  const nameId = useId();
  return (
    <section
      className={[styles.room, styles[tone], className].filter(Boolean).join(" ")}
      style={style}
      data-room={tone}
      data-alert={alert ?? undefined}
      data-testid={testId}
      aria-labelledby={nameId}
    >
      <header className={styles.lintel} data-room-lintel="">
        <h2 id={nameId} className={styles.name}>
          {name}
        </h2>
        <span className={styles.job}>{job}</span>
        {facts ? <span className={styles.facts}>{facts}</span> : null}
        <span className={styles.spacer} />
        {actions ? <span className={styles.actions}>{actions}</span> : null}
      </header>
      <div className={styles.body} data-room-body="">
        {children}
      </div>
      {floor ? (
        <div className={styles.floor} data-room-floor="" style={{ height: floor }}>
          {floorContent}
        </div>
      ) : null}
    </section>
  );
}
