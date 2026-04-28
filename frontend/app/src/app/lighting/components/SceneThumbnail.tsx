import styles from "./LightingRail.module.css";

export interface SceneThumbnailProps {
  src?: string;
  alt: string;
}

export function SceneThumbnail({ src, alt }: SceneThumbnailProps) {
  if (!src) {
    return <div className={styles.thumbPlaceholder} aria-label={alt} role="img" />;
  }
  return <img className={styles.thumb} src={src} alt={alt} />;
}
