import { useArm, type UseArmResult } from "@sse/design-system";
import type { PrompterSnapshot } from "@sse/engine-client";

// The visual overhaul's Teleprompter page (2026-10-05): one arm for the page,
// as Lighting's and Cameras' (`useLightingArming`, `useCamerasArming`).
// Replace, Update and Clear are press twice (D11), and so is Delete for good,
// the removed script's menu's destructive item, so two keys are never armed at
// once and the state display's armed row speaks of the one that is.
//
// Update and Clear are held only here: the hardware link acts on one request
// (only Replace is held there too). So no menu item or popover key calls them,
// and a menu hands Replace off to the plate's fixed key, which takes the
// second press.

export const UPDATE_ARM_KEY = "update";
export const CLEAR_ARM_KEY = "clear";

/** The keys that arm on the page, one rule per kind. */
export const teleprompterArmKey = {
  replace: (scriptId: string) => `replace:${scriptId}`,
};

/** The menu's destructive item's id; the menu arms `menu:<id>`. */
export const teleprompterMenuArmId = {
  delete: (scriptId: string) => `delete:${scriptId}`,
};

/** The key a menu's destructive item arms with that id (`Menu`'s rule). */
export const menuArmKey = (id: string) => `menu:${id}`;

/** The characters of a name the state display's armed row has room for beside its words. */
const ARM_NAME_ROOM = 20;

/** A script's name in the armed row, cut so `· press again` stays in view. */
export function armName(name: string): string {
  return name.length > ARM_NAME_ROOM ? `${name.slice(0, ARM_NAME_ROOM - 1)}…` : name;
}

/** The script an armed Replace names, or `null`. */
export function replaceArmedFor(key: string | null | undefined): string | null {
  return typeof key === "string" && key.startsWith("replace:") ? key.slice("replace:".length) : null;
}

/** The removed script an armed Delete for good names, or `null`. */
export function deleteArmedFor(key: string | null | undefined): string | null {
  const prefix = menuArmKey(teleprompterMenuArmId.delete(""));
  return typeof key === "string" && key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * What the state display's armed row says, before "· press again". Each arm is
 * said from what the page shows now, so a menu's arm (which arms with its
 * item's words at rest, "Delete for good…") reads as the page's own.
 */
export function teleprompterArmedWords(
  armed: { key: string; label: string },
  snapshot: Pick<PrompterSnapshot, "glass" | "scripts" | "removed"> | null
): string {
  if (armed.key === UPDATE_ARM_KEY) {
    return snapshot?.glass ? `Update ${armName(snapshot.glass.name)}` : armed.label;
  }
  if (armed.key === CLEAR_ARM_KEY) return "Clear the prompter";
  const replacing = replaceArmedFor(armed.key);
  if (replacing !== null) {
    const script = snapshot?.scripts.find((entry) => entry.id === replacing);
    return script ? `Replace with ${armName(script.name)}` : armed.label;
  }
  const deleting = deleteArmedFor(armed.key);
  if (deleting !== null) {
    const script = snapshot?.removed.find((entry) => entry.id === deleting);
    return script ? `Delete ${armName(script.name)} for good` : armed.label;
  }
  return armed.label;
}

/**
 * Whether an armed key can still be pressed again for what it said. An arm
 * whose key has gone, or would now do something else, is dropped: Update once
 * `NOT UPDATED` has cleared (no key offers it any more), Clear once nothing is
 * on the prompter, Replace once its script is not the selected one, is on the
 * prompter itself or the prompter is blank (Put on is one press then), and
 * Delete for good once its script is no longer among the removed ones.
 */
export function armStillStands(
  key: string,
  snapshot: Pick<PrompterSnapshot, "glass" | "scripts" | "removed"> | null,
  selectedId: string | null
): boolean {
  const glass = snapshot?.glass ?? null;
  if (key === UPDATE_ARM_KEY) return glass?.notUpdated === true;
  if (key === CLEAR_ARM_KEY) return glass !== null;
  const replacing = replaceArmedFor(key);
  if (replacing !== null) {
    return (
      glass !== null &&
      replacing === selectedId &&
      glass.scriptId !== replacing &&
      (snapshot?.scripts.some((script) => script.id === replacing) ?? false)
    );
  }
  const deleting = deleteArmedFor(key);
  if (deleting !== null) return snapshot?.removed.some((script) => script.id === deleting) ?? false;
  return true;
}

export function useTeleprompterArming(): UseArmResult {
  return useArm();
}
