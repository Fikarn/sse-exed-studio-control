// What the fixture double's prompter tests share (`prompter*.test.ts`), as the hardware
// link's `prompter/test_support.rs` does for its own: a double of its own, the request path
// the screen takes, and the layout a view would report. Test-only.
import { getFixtureScenario } from "@sse/test-fixtures";

import type { EventName, JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import type { PrompterLayoutLine } from "../../generated/snapshots/PrompterLayoutLine";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import { EngineRequestError } from "../engineRequestError";
import { createFixtureTransport } from "../fixtureTransport";

export interface SeenEvent {
  event: EventName;
  payload: JsonObject;
}

/** `per_line` words a line of `height` px, half a line between paragraphs, `END` right under the last line. */
export function layoutOf(paragraphs: PrompterParagraph[], perLine: number, height: number) {
  const lines: PrompterLayoutLine[] = [];
  let top = 0;
  paragraphs.forEach((paragraph, index) => {
    const words = (
      paragraph.runs
        .map((run) => run.text)
        .join("")
        .match(/\S+/gu) ?? []
    ).length;
    let word = 0;
    for (;;) {
      lines.push({ paragraph: index, word, top, height });
      top += height;
      word += perLine;
      if (word >= words) break;
    }
    top += height / 2;
  });
  return { lines, endTop: top };
}

/** A double of the `setup-ready` scenario, and the requests a Teleprompter page would send it. */
export function openPrompterDouble() {
  const transport = createFixtureTransport(getFixtureScenario("setup-ready"));
  const events: SeenEvent[] = [];
  transport.subscribe((envelope) => events.push({ event: envelope.event, payload: envelope.payload }));

  const call = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;

  /**
   * A request that must be refused: its code and its sentence. The refusal is the
   * `EngineRequestError` the Tauri transport throws for the hardware link's answer, so a
   * page reads the code the same way on either transport.
   */
  const refused = async (method: RequestMethod, params: JsonObject = {}) => {
    let answered: JsonValue;
    try {
      answered = await transport.request(method, params);
    } catch (error) {
      if (!(error instanceof EngineRequestError)) throw error;
      return { code: error.code, sentence: error.message };
    }
    throw new Error(`${method} should be refused, answered ${JSON.stringify(answered)}`);
  };

  const edit = (scriptId: string, paragraphs: string[]) =>
    call("prompter.script.edit", { scriptId, paragraphs: paragraphs.map((text) => ({ runs: [{ text }] })) });

  /** A new script holding `paragraphs`, as New script and the editor make one; its id. */
  const script = async (name: string, paragraphs: string[]) => {
    const id = (await call("prompter.script.create", { name })).scriptId as string;
    await edit(id, paragraphs);
    return id;
  };

  const snapshot = () => call("prompter.snapshot");
  const glass = async () => (await snapshot()).glass as JsonObject;

  /** Reports the layout a view would draw for the glass as it is. */
  const layOut = async (perLine: number, height: number) => {
    const shown = await call("prompter.glass.snapshot");
    const { lines, endTop } = layoutOf(shown.paragraphs as unknown as PrompterParagraph[], perLine, height);
    return call("prompter.layout.report", { layoutKey: shown.layoutKey as string, lines, endTop });
  };

  const reasons = () =>
    events.filter((seen) => seen.event === "prompter.changed").map((seen) => String(seen.payload.reason));

  return { transport, events, call, refused, edit, script, snapshot, glass, layOut, reasons };
}

/** A file as the page's file picker sends it: its name and its bytes in base64. */
export function fileParams(fileName: string, bytes: Uint8Array | string): JsonObject {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  raw.forEach((byte) => (binary += String.fromCharCode(byte)));
  return { fileName, contentBase64: btoa(binary) };
}
