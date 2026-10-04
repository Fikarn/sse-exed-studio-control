import type { ArmedKey } from "@sse/design-system";

/**
 * Shared types for the audio arm-then-apply safety pattern.
 *
 * Operator actions that can change the desk irreversibly (48V phantom, a
 * TotalMix snapshot load) arm first and apply only when the same action target
 * is activated a second time inside the timeout window. Since the visual
 * overhaul's Console pull request the arm is the design system's `useArm`
 * (`hooks/useAudioArming.ts`), shared with every menu on the page, so a key
 * and a menu's destructive item are never armed at once.
 */
export type AudioArmedAction = ArmedKey;

/** What a key arms: its key, the words the state display prints, its window. */
export interface AudioArmCandidate {
  key: string;
  label: string;
  timeoutMs?: number;
}

/** The arm key of a TotalMix snapshot slot's load (1 to 8; 2026-10-01). */
export function audioSnapshotLoadKey(slot: number) {
  return `snapshot-load:${slot}`;
}

/** The arm key of a channel's 48 V change; `next` is the state it changes to. */
export function audioPhantomKey(channelId: string, next: boolean) {
  return `phantom:${channelId}:${next}`;
}

/**
 * The menu's destructive item arms `menu:<its id>` (the design system's Menu);
 * the strip menu's "Turn 48 V off…" uses the phantom key as its id.
 */
export function audioMenuArmKey(itemId: string) {
  return `menu:${itemId}`;
}
