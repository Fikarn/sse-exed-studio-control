import horizontalLogo from "../assets/brand/sse-exed-horizontal-white.png";
import styles from "./Crest.module.css";

// The SSE Executive Education horizontal logotype in white. The shell
// (visual overhaul 3) sets it alone at the header's right, 40 px high, the
// brand's recommended size, with half its height clear on every side
// (`header`); the product's name stands at the far left, so the two never read
// as a lockup. The square `SSE` mark of the first overhaul went with it.
export type CrestSize = "header" | "sm" | "md" | "lg";

export interface CrestProps {
  size?: CrestSize;
  alt?: string;
  className?: string;
}

export const Crest = ({ size = "md", alt = "SSE Executive Education", className }: CrestProps) => {
  const classes = [styles.crest, styles[size], className].filter(Boolean).join(" ");
  return <img src={horizontalLogo} alt={alt} className={classes} />;
};
