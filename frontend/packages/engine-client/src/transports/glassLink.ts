import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  EventEnvelope,
  EventName,
  JsonObject,
  JsonValue,
  RequestEnvelope,
  ResponseEnvelope,
} from "../generated/protocol";
import type { PrompterGlassSnapshot } from "../generated/snapshots/PrompterGlassSnapshot";
import type { EngineTransport, PrompterLayoutReportRequest } from "../types";
import { EngineRequestError } from "./engineRequestError";
import { createSessionNonce } from "./sessionNonce";

// What the prompter's window has of the hardware link (the Prompter XL's
// window). The window shows the glass on the Prompter XL and does nothing
// else, so its link is a narrow one: it hears what the hardware link says,
// reads what the glass draws, reports the layout it measured, and tells the
// shell that it draws. It never starts, stops or restarts the hardware link,
// and it changes nothing; the operator's window does all of that. The shell
// holds the window to it by the window's name (`shell_commands.rs`), so a
// request this file does not make would be refused there.

/** The prompter's window, as the shell's `tauri.conf.json` names it. */
export const PROMPTER_WINDOW_LABEL = "prompter";

/** The two requests the prompter's window sends. */
type GlassMethod = "prompter.glass.snapshot" | "prompter.layout.report";

export interface GlassLink {
  /**
   * Hears what the hardware link says to this window: what the prompter did,
   * and the hardware link's start and its end. Resolves, once it listens,
   * with what stops it.
   */
  listen(listener: (event: EventEnvelope<EventName>) => void): Promise<() => void>;
  /** `prompter.glass.snapshot`: what the glass draws. */
  readGlass(): Promise<PrompterGlassSnapshot>;
  /** `prompter.layout.report`: the layout this window measured. */
  reportLayout(report: PrompterLayoutReportRequest): Promise<JsonValue>;
  /**
   * Tells the shell that the page draws what it has, or what keeps it from
   * drawing. The shell tells the hardware link that the glass draws only
   * while this is said, once a second.
   */
  alive(problem?: string): Promise<void>;
}

interface TauriEventPayload {
  event: EventEnvelope<EventName>;
}

/** The link in the prompter's window of the app. */
export function createTauriGlassLink(): GlassLink {
  const sessionNonce = createSessionNonce();
  let sequence = 0;

  const request = async (method: GlassMethod, params: JsonObject = {}): Promise<JsonValue> => {
    sequence += 1;
    const envelope: RequestEnvelope = {
      type: "request",
      id: `${method}:${sequence}:${sessionNonce}`,
      method,
      params,
    };
    const response = await invoke<ResponseEnvelope>("engine_request", { request: envelope });
    if (!response.ok) {
      throw new EngineRequestError(
        response.error?.code || "UNKNOWN_ERROR",
        response.error?.message ?? `Request failed for ${method}`
      );
    }
    return response.result ?? {};
  };

  return {
    listen(listener) {
      // This window is the target. A listener without one hears everything
      // the shell emits, whichever window it is for: the meters, 30 times a
      // second, among them.
      return listen<TauriEventPayload>("engine://event", (payload) => listener(payload.payload.event), {
        target: { kind: "WebviewWindow", label: PROMPTER_WINDOW_LABEL },
      });
    },
    async readGlass() {
      return (await request("prompter.glass.snapshot")) as unknown as PrompterGlassSnapshot;
    },
    reportLayout(report) {
      return request("prompter.layout.report", {
        layoutKey: report.layoutKey,
        lines: report.lines.map((line) => ({ ...line })),
        endTop: report.endTop,
      });
    },
    async alive(problem) {
      await invoke("prompter_window_alive", problem === undefined ? {} : { problem });
    },
  };
}

/**
 * The link over a transport that is already there: the engine's test double,
 * in a browser and in the page tests. It sends the same two requests and
 * nothing else; its sign of life goes nowhere, since no shell keeps a window.
 */
export function glassLinkOver(transport: EngineTransport): GlassLink {
  return {
    async listen(listener) {
      const stop = transport.subscribe(listener);
      await transport.initialize?.();
      return stop;
    },
    async readGlass() {
      return (await transport.request("prompter.glass.snapshot")) as unknown as PrompterGlassSnapshot;
    },
    reportLayout(report) {
      return transport.request("prompter.layout.report", {
        layoutKey: report.layoutKey,
        lines: report.lines.map((line) => ({ ...line })),
        endTop: report.endTop,
      });
    },
    async alive() {},
  };
}
