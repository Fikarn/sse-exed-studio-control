import horizontalLogo from "../assets/brand/sse-exed-horizontal-white.png";
import styles from "./Crest.module.css";

export type CrestSize = "sm" | "md" | "lg";

export interface CrestProps {
  size?: CrestSize;
  alt?: string;
  className?: string;
  /** `logo` (default): the SSE Executive Education horizontal white logo.
   *  `mark` (visual overhaul A, Slice 2): the 30 px square crest of the A
   *  header — an ink box with `SSE` — which reads in every theme, where the
   *  white logo would vanish on Bone; the wordmark's eyebrow names the owner. */
  variant?: "logo" | "mark";
}

export const Crest = ({ size = "md", alt = "SSE Executive Education", className, variant = "logo" }: CrestProps) => {
  if (variant === "mark") {
    return (
      <span className={[styles.mark, className].filter(Boolean).join(" ")} role="img" aria-label={alt}>
        SSE
      </span>
    );
  }
  const classes = [styles.crest, styles[size], className].filter(Boolean).join(" ");
  return <img src={horizontalLogo} alt={alt} className={classes} />;
};
