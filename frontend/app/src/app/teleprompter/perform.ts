import type { JsonValue } from "@sse/engine-client";

// How the Teleprompter's keys send a request (new pages program, Slices 6a
// and 6b): `perform` in `TeleprompterWorkspace.tsx`.

/** Marks a request of the take itself, which never waits for the editor's save. */
export const TAKE = "take" as const;

export type PerformAction = (
  action: () => Promise<JsonValue>,
  announce?: boolean,
  kind?: typeof TAKE
) => Promise<JsonValue | null>;
