import styles from "./Lamp.module.css";

// Visual overhaul A, Slice 2 (system §4, §7); Atrium: an 8 px circle, no
// bloom. A lit lamp is filled with its tone's colour (`data-lit` marks it for
// the light census); an unlit lamp is hollow, a ring in the quiet ink. A lamp
// never stands alone: the word within 8 px belongs to the host (LampChip,
// LampWord).
export type LampTone = "ok" | "attention" | "error" | "info" | "off";

export interface LampProps {
  tone: LampTone;
  className?: string;
}

export const Lamp = ({ tone, className }: LampProps) => {
  const lit = tone !== "off";
  return (
    <span
      className={[styles.lamp, styles[tone], className].filter(Boolean).join(" ")}
      data-lamp={tone}
      data-lit={lit ? "" : undefined}
      aria-hidden="true"
    />
  );
};
