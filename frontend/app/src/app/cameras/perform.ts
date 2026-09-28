import type { JsonValue } from "@sse/engine-client";

// How the Cameras page's keys send a request: `perform` in
// `CamerasWorkspace.tsx`. A refusal comes back as the hardware link's
// sentence, shown as a notice; the answer's own sentence is shown when the
// key asks for it.

export type PerformAction = (action: () => Promise<JsonValue>, announce?: boolean) => Promise<JsonValue | null>;

/** The arm window of the stop, the deck's (D14): a second press within 3 s. */
export const STOP_WINDOW_MS = 3000;
