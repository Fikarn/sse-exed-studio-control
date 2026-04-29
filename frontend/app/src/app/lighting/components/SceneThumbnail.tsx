import styles from "./LightingRail.module.css";

export interface SceneThumbnailProps {
  src?: string;
  alt: string;
}

export function SceneThumbnail({ src, alt }: SceneThumbnailProps) {
  if (!src) {
    return <div className={styles.thumbPlaceholder} aria-label={alt} role="img" />;
  }
  // draggable={false} so a tile-wide drag (e.g. scene reorder) isn't
  // hijacked by the browser's default image-drag behaviour.
  return <img className={styles.thumb} src={src} alt={alt} draggable={false} />;
}
