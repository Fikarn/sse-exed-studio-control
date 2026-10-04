import { useArm, type UseArmResult } from "@sse/design-system";
import type { LightingSnapshot } from "@sse/engine-client";

// The visual overhaul's Lighting page (2026-10-04): one arm for the page, as
// the Console has one (`useAudioArming`). The Save row, CUT ALL and every
// menu's "Delete …" share it, so two keys are never armed at once and the
// state display's armed row speaks of the one that is.

/** CUT ALL's window: the deck's ALL OFF, which arms `OFF?` for 3 s. */
export const CUT_ALL_WINDOW_MS = 3000;

export const SAVE_SCENE_ARM_KEY = "save-scene";
export const CUT_ALL_ARM_KEY = "cut-all";

/** The menu's destructive items' ids, one per object (the menu arms `menu:<id>`). */
export const deleteArmId = {
  scene: (id: string) => `scene-delete:${id}`,
  group: (id: string) => `group-delete:${id}`,
  fixture: (id: string) => `fixture-delete:${id}`,
  palette: (id: string) => `palette-delete:${id}`,
};

export function useLightingArming(): UseArmResult {
  return useArm();
}

/** What the state display's armed row says, before "· press again". */
export function lightingArmedWords(
  armed: { key: string; label: string },
  snapshot: Pick<LightingSnapshot, "scenes" | "groups" | "fixtures" | "palettes"> | null
): string {
  const match = /^menu:(scene|group|fixture|palette)-delete:(.+)$/.exec(armed.key);
  if (!match) return armed.label;
  const [, kind, id] = match;
  const list =
    kind === "scene"
      ? snapshot?.scenes
      : kind === "group"
        ? snapshot?.groups
        : kind === "fixture"
          ? snapshot?.fixtures
          : snapshot?.palettes;
  const name = list?.find((entry) => entry.id === id)?.name;
  return name ? `Delete ${kind} ${name}` : `Delete the ${kind}`;
}
