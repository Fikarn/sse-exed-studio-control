import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  EventEnvelope,
  EventName,
  JsonObject,
  RequestEnvelope,
  RequestMethod,
  ResponseEnvelope,
} from "../generated/protocol";
import type { EngineTransport } from "../types";

interface TauriEventPayload {
  event: EventEnvelope<EventName>;
}

/** What `engine_start` answers: the shell's `EngineBootstrapSummary`. */
interface EngineStartSummary {
  binary_path?: string;
  generation?: number;
  pid?: number;
  protocol?: string;
  running?: boolean;
}

/**
 * A nonce for this transport instance, so the ids of one webview session
 * never collide with ids still pending in the shell from an earlier one — a
 * reload restarts the sequence at 1 while the shell process lives on.
 */
function createSessionNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createTauriTransport(): EngineTransport {
  const listeners = new Set<(event: EventEnvelope<EventName>) => void>();
  let unlistenPromise: Promise<UnlistenFn> | null = null;
  // 2026-09 production readiness, Slice 4 (finding F08): ids were
  // `${method}:${Date.now()}`, so two requests for one method inside the same
  // millisecond — a store refresh fans several out — shared one id and one
  // reply slot in the shell, and whichever response came first went to the
  // wrong caller. A per-instance sequence and a session nonce make every id
  // unique for the life of the shell; the shell refuses a duplicate outright
  // (`DUPLICATE_REQUEST_ID`).
  const sessionNonce = createSessionNonce();
  let sequence = 0;

  return {
    async initialize() {
      if (unlistenPromise) {
        return;
      }

      // 2026-09 production readiness, Slice 3: the listener is registered
      // before the engine process exists. An engine that refuses its database
      // emits `engine.startupFailed` within milliseconds of starting, and an
      // event emitted before the webview listens is dropped — the shell then
      // waited ten seconds and reported a ready timeout instead.
      const pendingListen = listen<TauriEventPayload>("engine://event", (payload) => {
        const event = payload.payload.event;
        for (const listener of listeners) {
          listener(event);
        }
      });
      unlistenPromise = pendingListen;

      let unlisten: UnlistenFn;
      try {
        unlisten = await pendingListen;
      } catch (error) {
        unlistenPromise = null;
        throw error;
      }

      try {
        const launch = await invoke<EngineStartSummary | null>("engine_start");
        // 2026-09 production readiness, Slice 5 (finding F09): the store keeps
        // the launch number, so an `engine.exited` about a process the shell
        // already replaced is told apart from one about the current process.
        return {
          generation: typeof launch?.generation === "number" ? launch.generation : null,
          pid: typeof launch?.pid === "number" ? launch.pid : null,
        };
      } catch (error) {
        unlisten();
        unlistenPromise = null;
        throw error;
      }
    },
    async request(method: RequestMethod, params: JsonObject = {}) {
      sequence += 1;
      const request: RequestEnvelope = {
        type: "request",
        id: `${method}:${sequence}:${sessionNonce}`,
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
