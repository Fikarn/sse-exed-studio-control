import { MousePointerClick } from "lucide-react";

import styles from "../AudioInspector.module.css";

interface AudioEmptyInspectorProps {
  title: string;
  description: string;
}

/**
 * Shared "no source selected" placeholder for the inspector panes (overview, EQ,
 * dynamics, sends). Upgraded from a bare h3/p to an icon-chip + title + body so
 * the empty state reads as designed rather than as raw text. Deliberately stays
 * in the audio token namespace (--fg/--bg/--accent) so it theme-adapts across
 * Studio/Graphite/Bone; the design-system EmptyState is wired to the undefined
 * --color-studio-* namespace and does not adapt inside the audio shell.
 */
export function AudioEmptyInspector({ title, description }: AudioEmptyInspectorProps) {
  return (
    <div className={styles.emptyInspector}>
      <span className={styles.emptyInspectorIcon} aria-hidden="true">
        <MousePointerClick size={24} strokeWidth={1.75} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
