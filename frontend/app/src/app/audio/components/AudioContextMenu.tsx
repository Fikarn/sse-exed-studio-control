import type { CSSProperties } from "react";

import { audioChannelSupportsPhase } from "../audioViewModel";
import styles from "../AudioWorkspace.module.css";
import type { AudioChannelEntry } from "../../shellData";

export function AudioContextMenu({
  actionsAllowed,
  channel,
  onClose,
  onRename,
  onResetUnity,
  onTogglePhase,
  position,
}: {
  actionsAllowed: boolean;
  channel: AudioChannelEntry | null;
  onClose: () => void;
  onRename: (channelId: string, currentName: string) => void;
  onResetUnity: (channelId: string) => void;
  onTogglePhase: (channelId: string, next: boolean) => void;
  position: { x: number; y: number } | null;
}) {
  if (!position) return null;

  const left = Math.max(8, Math.min(position.x, window.innerWidth - 240));
  const top = Math.max(8, Math.min(position.y, window.innerHeight - 300));
  const canMutate = Boolean(channel && actionsAllowed);
  const canFlipPhase = Boolean(channel && actionsAllowed && audioChannelSupportsPhase(channel));

  return (
    <div
      className={styles.contextMenu}
      data-testid="audio-context-menu"
      role="menu"
      style={{ left, top } as CSSProperties}
    >
      <span>{channel ? channel.name : "Channel actions"}</span>
      <button
        disabled={!canMutate}
        onClick={() => {
          if (!channel) return;
          onResetUnity(channel.id);
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        Reset to unity
      </button>
      <button
        disabled={!canFlipPhase}
        onClick={() => {
          if (!channel) return;
          onTogglePhase(channel.id, !channel.phase);
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        Flip polarity
      </button>
      <button
        disabled={!canMutate}
        onClick={() => {
          if (!channel) return;
          onRename(channel.id, channel.name);
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        Rename...
      </button>
      <button disabled role="menuitem" type="button">
        Add to group...
      </button>
      <button disabled role="menuitem" type="button">
        Send to bus...
      </button>
      <button disabled role="menuitem" type="button">
        Copy settings
      </button>
      <button disabled role="menuitem" type="button">
        Paste settings
      </button>
      <button disabled role="menuitem" type="button">
        Link stereo
      </button>
      <small>Unsupported actions require engine support</small>
    </div>
  );
}
