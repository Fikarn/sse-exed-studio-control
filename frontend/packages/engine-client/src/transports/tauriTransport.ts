import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  EventEnvelope,
  EventName,
  JsonObject,
  JsonValue,
  RequestEnvelope,
  RequestMethod,
  ResponseEnvelope,
} from "../generated/protocol";
import type { EngineTransport } from "../types";

interface TauriEventPayload {
  event: EventEnvelope<EventName>;
}

export function createTauriTransport(): EngineTransport {
  const listeners = new Set<(event: EventEnvelope<EventName>) => void>();
  let unlistenPromise: Promise<UnlistenFn> | null = null;

  return {
    async initialize() {
      if (unlistenPromise) {
        return;
      }

      unlistenPromise = listen<TauriEventPayload>("engine://event", (payload) => {
        const event = payload.payload.event;
        for (const listener of listeners) {
          listener(event);
        }
      });

      try {
        await invoke("engine_start");
      } catch (error) {
        const unlisten = await unlistenPromise;
        unlisten();
        unlistenPromise = null;
        throw error;
      }
    },
    async request(method: RequestMethod, params: JsonObject = {}) {
      const request: RequestEnvelope = {
        type: "request",
        id: `${method}:${Date.now()}`,
        method,
        params,
      };
      const response = await invoke<ResponseEnvelope>("engine_request", { request });

      if (!response.ok) {
        const message = response.error?.message ?? `Request failed for ${method}`;
        throw new Error(message);
      }

      return response.result ?? {};
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      const unlisten = unlistenPromise ? await unlistenPromise : null;
      unlistenPromise = null;
      listeners.clear();
      if (unlisten) {
        unlisten();
      }
      await invoke("engine_stop");
    },
  };
}
