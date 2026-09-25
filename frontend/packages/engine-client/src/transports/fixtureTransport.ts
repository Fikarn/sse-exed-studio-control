import { type FixtureRequestHandler, type FixtureRequestContext, NOT_HANDLED } from "./fixture/requestContext";
import { handleFixtureLightingRequest } from "./fixture/lightingRequests";
import { handleFixtureAudioRequest } from "./fixture/audioRequests";
import { handleFixtureSetupRequest } from "./fixture/setupRequests";
import type { FixtureScenario, EngineTransport } from "../types";
import {
  PROTOCOL_VERSION,
  type EventEnvelope,
  type EventName,
  type JsonObject,
  type RequestMethod,
  type JsonValue,
} from "../generated/protocol";
import { createMutableFixtureState, synchronizeFixtureState } from "./fixture/state";
import { recordUiActions } from "./fixture/actionLog";
import { fixtureEvent, asRecord, cloneJson } from "./fixture/json";
import {
  refreshFixtureAudioMetering,
  audioMeterPayloadFromSnapshot,
  AUDIO_METERING_TICK_MS,
} from "./fixture/audioMetering";

export { calculateNextFixturePeakHold } from "./fixture/audioMetering";

// The domains, in the order the requests are offered to them. The snapshot
// reads stay in `handleRequest` below; everything that changes the double is
// in its domain's module under `fixture/`.
const FIXTURE_REQUEST_HANDLERS: readonly FixtureRequestHandler[] = [
  handleFixtureLightingRequest,
  handleFixtureAudioRequest,
  handleFixtureSetupRequest,
];

export function createFixtureTransport(scenario: FixtureScenario): EngineTransport {
  const listeners = new Set<(event: EventEnvelope<EventName>) => void>();
  const state = createMutableFixtureState(scenario);
  const audioMeteringActive = scenario.audioMeteringActive === true;
  const startupDelayMs = typeof scenario.startupDelayMs === "number" ? scenario.startupDelayMs : 0;
  const startupFailure =
    scenario.startupFailure && typeof scenario.startupFailure === "object"
      ? (scenario.startupFailure as JsonObject)
      : null;
  let startupResolved = startupDelayMs <= 0 && startupFailure === null;
  let startupTimeoutId: number | null = null;
  let audioMeteringIntervalId: number | null = null;
  let audioMeteringSequence = 0;
  let audioMeteringStartedAtMs = performance.now();
  let resolveStartupGate = () => {};
  let rejectStartupGate = (_error: unknown) => {};
  const startupGate = new Promise<void>((resolve, reject) => {
    resolveStartupGate = resolve;
    rejectStartupGate = reject;
  });
  synchronizeFixtureState(state);

  const emit = (event: EventName, payload: JsonObject = {}) => {
    const envelope = fixtureEvent(event, payload);
    for (const listener of listeners) {
      listener(envelope);
    }
  };

  const startAudioMeteringTicks = () => {
    if (audioMeteringIntervalId !== null) {
      window.clearInterval(audioMeteringIntervalId);
      audioMeteringIntervalId = null;
    }
    if (!audioMeteringActive) {
      return;
    }
    if (!refreshFixtureAudioMetering(state)) {
      return;
    }
    audioMeteringSequence = 0;
    audioMeteringStartedAtMs = performance.now();
    audioMeteringIntervalId = window.setInterval(() => {
      if (refreshFixtureAudioMetering(state)) {
        audioMeteringSequence += 1;
        emit(
          "audio.meters",
          audioMeterPayloadFromSnapshot(
            asRecord(state.audioSnapshot) ?? {},
            audioMeteringSequence,
            audioMeteringStartedAtMs
          )
        );
      }
    }, AUDIO_METERING_TICK_MS);
  };
  const context: FixtureRequestContext = { state, emit };

  const handleRequest = (method: RequestMethod, params: JsonObject): JsonValue => {
    switch (method) {
      case "engine.ping":
        return {
          protocol: PROTOCOL_VERSION,
          engineVersion: "fixture",
        };
      case "health.snapshot":
        return cloneJson(state.healthSnapshot);
      case "app.snapshot":
        return cloneJson(state.appSnapshot);
      case "commissioning.snapshot":
        return cloneJson(state.commissioningSnapshot);
      case "audio.snapshot":
        refreshFixtureAudioMetering(state);
        return cloneJson(state.audioSnapshot);
      case "support.snapshot":
        return cloneJson(state.supportSnapshot);
      case "controlSurface.snapshot":
        return cloneJson(state.controlSurfaceSnapshot);
      default: {
        for (const handleDomainRequest of FIXTURE_REQUEST_HANDLERS) {
          const result = handleDomainRequest(context, method, params);
          if (result !== NOT_HANDLED) {
            // The action log, as the hardware link writes it at its one entry
            // point: after the answer, and never while storage is refused.
            if (startupFailure === null) recordUiActions(state, method, params, result);
            return result;
          }
        }
        return {};
      }
    }
  };

  return {
    async initialize() {
      const emitStartupEvent = () => {
        startupTimeoutId = null;
        startupResolved = true;
        if (startupFailure) {
          rejectStartupGate(startupFailure);
        } else {
          resolveStartupGate();
          startAudioMeteringTicks();
        }
        emit(
          startupFailure ? "engine.startupFailed" : "engine.ready",
          startupFailure ?? {
            protocol: PROTOCOL_VERSION,
            engineVersion: "fixture",
          }
        );
      };

      if (startupTimeoutId !== null) {
        window.clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      }

      if (startupDelayMs > 0) {
        startupTimeoutId = window.setTimeout(emitStartupEvent, startupDelayMs);
        return;
      }

      startupTimeoutId = window.setTimeout(emitStartupEvent, 0);
    },
    async request(method, params = {}) {
      if (typeof window !== "undefined" && window.__SSE_TEST_ENGINE_REQUEST_COUNTS__) {
        window.__SSE_TEST_ENGINE_REQUEST_COUNTS__[method] =
          (window.__SSE_TEST_ENGINE_REQUEST_COUNTS__[method] ?? 0) + 1;
      }
      if (method === "engine.ping" && !startupResolved) {
        await startupGate;
      }
      return handleRequest(method, params);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      if (startupTimeoutId !== null) {
        window.clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      }
      if (audioMeteringIntervalId !== null) {
        window.clearInterval(audioMeteringIntervalId);
        audioMeteringIntervalId = null;
      }
      listeners.clear();
    },
  };
}
