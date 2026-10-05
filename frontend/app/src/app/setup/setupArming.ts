import type { ArmedKey } from "@sse/design-system";

// The visual overhaul's Setup page (2026-10-05): one arm for the page, as
// Lighting's, Cameras' and the Teleprompter's, so two keys are never armed at
// once and the state display's armed row speaks of the one that is.
//
// Two kinds of press arm here. A press that would move the runner of a
// published setup (a step key, `Back to …`, `Run all probes`) unpublishes it
// and locks Lighting, Audio, Cameras and Teleprompter: it arms first, for 3 s
// (the owner's decision, 2026-09-28), and only the page holds it, since the
// hardware link takes any runner stage it is sent. And `Forget CAM n…`, the
// camera menu's destructive item, which arms in place.

export const BACK_ARM_KEY = "back";
export const RUN_PROBES_ARM_KEY = "run-all-probes";

/** The keys that arm on the page, one rule per kind. */
export const setupArmKey = {
  step: (stepId: string) => `step:${stepId}`,
};

/** The menu's destructive item's id; the menu arms `menu:<id>`. */
export const setupMenuArmId = {
  forget: (camera: number) => `forget:${camera}`,
};

/** The key a menu's destructive item arms with that id (`Menu`'s rule). */
export const menuArmKey = (id: string) => `menu:${id}`;

/** The step an armed step key names, or `null`. */
export function stepArmedFor(key: string | null | undefined): string | null {
  return typeof key === "string" && key.startsWith("step:") ? key.slice("step:".length) : null;
}

/** Whether the armed press would unpublish the setup at its second press. */
export function isUnpublishArm(key: string | null | undefined): boolean {
  return key === BACK_ARM_KEY || key === RUN_PROBES_ARM_KEY || stepArmedFor(key) !== null;
}

/** The camera an armed `Forget CAM n…` names, or `null`. */
export function forgetArmedFor(key: string | null | undefined): number | null {
  const prefix = menuArmKey(setupMenuArmId.forget(0)).slice(0, -1);
  if (typeof key !== "string" || !key.startsWith(prefix)) return null;
  const camera = Number(key.slice(prefix.length));
  return Number.isInteger(camera) ? camera : null;
}

/**
 * What the state display's armed row says, before "· press again": what the
 * second press does, in the page's words. That it unpublishes the setup is
 * the display's sentence while such a press is armed, so the row has room for
 * where the press goes.
 */
export function setupArmedWords(
  armed: Pick<ArmedKey, "key" | "label">,
  labels: { step: (stepId: string) => string | null; back: string | null }
): string {
  const step = stepArmedFor(armed.key);
  if (step !== null) {
    const label = labels.step(step);
    return label ? `Go to ${label}` : armed.label;
  }
  if (armed.key === BACK_ARM_KEY) return labels.back ? `Back to ${labels.back}` : armed.label;
  if (armed.key === RUN_PROBES_ARM_KEY) return "Run all probes";
  const camera = forgetArmedFor(armed.key);
  if (camera !== null) return `Forget CAM ${camera}`;
  return armed.label;
}
