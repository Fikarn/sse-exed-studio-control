import horizontalLogo from "../assets/brand/sse-exed-horizontal-white.png";
import styles from "./Crest.module.css";

export type CrestSize = "sm" | "md" | "lg";

export interface CrestProps {
  size?: CrestSize;
  alt?: string;
  className?: string;
}

export const Crest = ({ size = "md", alt = "SSE Executive Education", className }: CrestProps) => {
  const classes = [styles.crest, styles[size], className].filter(Boolean).join(" ");
  return <img src={horizontalLogo} alt={alt} className={classes} />;
};
