// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { EventName, JsonObject, EventEnvelope, JsonValue } from "../../generated/protocol";

export function fixtureEvent<TEvent extends EventName>(event: TEvent, payload: JsonObject = {}) {
  return {
    type: "event",
    event,
    payload,
  } satisfies EventEnvelope<TEvent>;
}

export function cloneJson<T extends JsonValue>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}
