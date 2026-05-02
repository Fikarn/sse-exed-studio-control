import { LogOut, Save, Trash2 } from "lucide-react";

import { Button, StatusDot } from "@sse/design-system";

import styles from "./PreviewBanner.module.css";

export interface PreviewBannerProps {
  busy?: boolean;
  dirty: boolean;
  targetSceneName?: string | null;
  onDiscard: () => void;
  onExit: () => void;
  onSave: () => void;
}

export function PreviewBanner({ busy = false, dirty, targetSceneName, onDiscard, onExit, onSave }: PreviewBannerProps) {
  return (
    <section className={styles.banner} aria-label="Lighting preview mode">
      <div className={styles.copy} aria-live="polite">
        <span className={styles.eyebrow}>
          <StatusDot state={dirty ? "attn" : "info"} size="sm" />
          Editing offline
        </span>
        <span className={styles.detail}>
          {targetSceneName ? `Preview target: ${targetSceneName}. ` : ""}
          Live rig is unchanged. Save commits scene data, or discard preview.
        </span>
      </div>
      <div className={styles.actions}>
        <Button
          size="compact"
          variant="primary"
          onClick={onSave}
          disabled={busy || !targetSceneName}
          leadingVisual={<Save aria-hidden="true" size={13} strokeWidth={1.75} />}
        >
          Save
        </Button>
        <Button
          size="compact"
          variant="secondary"
          onClick={onDiscard}
          disabled={busy}
          leadingVisual={<Trash2 aria-hidden="true" size={13} strokeWidth={1.75} />}
        >
          Discard
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={onExit}
          disabled={busy}
          leadingVisual={<LogOut aria-hidden="true" size={13} strokeWidth={1.75} />}
        >
          Exit preview
        </Button>
      </div>
    </section>
  );
}
