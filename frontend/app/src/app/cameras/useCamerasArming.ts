import { useArm, type UseArmResult } from "@sse/design-system";
import type { CameraNumber, CamerasSnapshot } from "@sse/engine-client";

import { cameraOf, releaseLabel } from "./camerasModel";

// The visual overhaul's Cameras page (2026-10-05): one arm for the page, as
// Lighting's (`useLightingArming`). REC's stop, the plate's Release, the
// format's and the look's choices and the selected camera's menu share it, so
// two keys are never armed at once and the state display's armed row speaks
// of the one that is. Every arm names the camera it acts on, so the page can
// drop it when that camera is released, lost or selected away.

/** REC's stop: always CAM 1's (D14), in the deck's 3 s (`STOP_WINDOW_MS`). */
export const STOP_ARM_KEY = "stop";

/** The keys that arm, one rule per kind. */
export const camerasArmKey = {
  release: (camera: CameraNumber) => `release:${camera}`,
  format: (camera: CameraNumber, setting: "resolution" | "frameRate", value: string) =>
    `format:${camera}:${setting}:${value}`,
  look: (camera: CameraNumber, setting: "dynamicRange" | "displayLut" | "displayLutOn", value: string | boolean) =>
    `look:${camera}:${setting}:${String(value)}`,
};

/** The menu's destructive item's id; the menu arms `menu:<id>`. */
export const camerasMenuArmId = {
  release: (camera: CameraNumber) => `release:${camera}`,
};

/** The key a menu's destructive item arms with that id (`Menu`'s rule). */
export const menuArmKey = (id: string) => `menu:${id}`;

/** The camera an armed key acts on; `null` when it names none. */
export function armedCamera(key: string): CameraNumber | null {
  if (key === STOP_ARM_KEY) return 1;
  const match = /^(?:menu:)?(?:release|format|look):([123])(?::|$)/.exec(key);
  if (!match) return null;
  return match[1] === "2" ? 2 : match[1] === "3" ? 3 : 1;
}

/** Whether the armed key is one of a popover's: the format's or the look's choices. */
export function armedInGroup(key: string | null | undefined, group: "format" | "look"): boolean {
  return typeof key === "string" && key.startsWith(`${group}:`);
}

/** Whether Release is armed for `camera`, on the plate's key or in its menu. */
export function releaseArmed(key: string | null | undefined, camera: CameraNumber): boolean {
  return key === camerasArmKey.release(camera) || key === menuArmKey(camerasMenuArmId.release(camera));
}

/**
 * What the state display's armed row says, before "· press again". A menu
 * arms with its item's words at rest ("Release CAM 1…"), so its arm is said
 * here as the plate's key says it.
 */
export function camerasArmedWords(armed: { key: string; label: string }, snapshot: CamerasSnapshot | null): string {
  const match = /^menu:release:([123])$/.exec(armed.key);
  if (!match) return armed.label;
  const camera = snapshot ? cameraOf(snapshot, Number(match[1])) : null;
  return camera ? releaseLabel(camera) : armed.label;
}

export function useCamerasArming(): UseArmResult {
  return useArm();
}
