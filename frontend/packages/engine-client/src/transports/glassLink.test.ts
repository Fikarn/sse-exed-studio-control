import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The Prompter XL's window: its link to the hardware link is a narrow one. It
// listens as its own window, sends two requests and its sign of life, and
// never starts, stops or restarts the hardware link. The shell refuses its
// window anything else (`shell_commands.rs`); this file holds the page to
// what the shell allows, so a refusal is never the first to say so.

const { invoked, listened } = vi.hoisted(() => ({
  invoked: [] as Array<{ command: string; args: Record<string, unknown> | undefined }>,
  listened: [] as Array<{ name: string; options: unknown }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    if (command === "engine_request") {
      const { request } = args as { request: { id: string; method: string } };
      if (request.method === "prompter.layout.report") {
        return { type: "response", id: request.id, ok: true, result: { accepted: true } };
      }
      if (invoked.some((call) => call.command === "refuse")) {
        return {
          type: "response",
          id: request.id,
          ok: false,
          error: { code: "INTERNAL", message: "The prompter's state could not be read." },
        };
      }
      return {
        type: "response",
        id: request.id,
        ok: true,
        result: { scriptId: null, name: null, layoutKey: null, paragraphs: [], look: {}, sizePx: 88, anchor: null },
      };
    }
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, _handler: unknown, options?: unknown) => {
    listened.push({ name, options });
    return () => {
      listened.push({ name: `unlisten:${name}`, options: undefined });
    };
  }),
}));

import { EngineRequestError } from "./engineRequestError";
import { createTauriGlassLink, glassLinkOver, PROMPTER_WINDOW_LABEL } from "./glassLink";

describe("createTauriGlassLink", () => {
  beforeEach(() => {
    invoked.length = 0;
    listened.length = 0;
  });

  it("listens as the prompter's own window, so it hears what is sent to that window and nothing else", async () => {
    const link = createTauriGlassLink();
    const stop = await link.listen(() => {});
    expect(listened).toEqual([
      { name: "prompter://event", options: { target: { kind: "WebviewWindow", label: "prompter" } } },
    ]);
    expect(PROMPTER_WINDOW_LABEL).toBe("prompter");
    stop();
    expect(listened.at(-1)?.name).toBe("unlisten:prompter://event");
    // Listening starts nothing.
    expect(invoked).toEqual([]);
  });

  it("sends its two requests and its sign of life, and nothing else", async () => {
    const link = createTauriGlassLink();
    await link.readGlass();
    await link.reportLayout({
      layoutKey: "g1-l0",
      lines: [{ paragraph: 0, word: 0, top: 0, height: 123 }],
      endTop: 800,
    });
    await link.alive();
    await link.alive("the text could not be drawn");

    expect(invoked.map((call) => call.command)).toEqual([
      "engine_request",
      "engine_request",
      "prompter_window_alive",
      "prompter_window_alive",
    ]);
    const requests = invoked
      .filter((call) => call.command === "engine_request")
      .map((call) => (call.args as { request: { id: string; method: string; params: unknown; type: string } }).request);
    expect(requests.map((request) => request.method)).toEqual(["prompter.glass.snapshot", "prompter.layout.report"]);
    expect(requests[1].params).toEqual({
      layoutKey: "g1-l0",
      lines: [{ paragraph: 0, word: 0, top: 0, height: 123 }],
      endTop: 800,
    });
    // Ids of its own: a sequence and a nonce, as the operator's window has.
    expect(requests[0].id).toMatch(/^prompter\.glass\.snapshot:1:[a-z0-9]+$/);
    expect(requests[1].id).toMatch(/^prompter\.layout\.report:2:[a-z0-9]+$/);
    expect(invoked[2].args).toEqual({});
    expect(invoked[3].args).toEqual({ problem: "the text could not be drawn" });
  });

  it("throws the hardware link's refusal with its code", async () => {
    invoked.push({ command: "refuse", args: undefined });
    const refusal = await createTauriGlassLink()
      .readGlass()
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(EngineRequestError);
    expect(refusal).toMatchObject({ code: "INTERNAL", message: "The prompter's state could not be read." });
  });

  // The file itself: whatever is added to it later, it names no command of
  // the shell's but the two the prompter's window may call, and no request
  // but its two.
  it("names no other command and no other request", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "glassLink.ts"), "utf8");
    const commands = [...source.matchAll(/invoke(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect([...new Set(commands)].sort()).toEqual(["engine_request", "prompter_window_alive"]);
    const methods = [...source.matchAll(/"((?:prompter|engine|app|health|audio|lighting|cameras)\.[a-zA-Z.]+)"/g)]
      .map((match) => match[1])
      .filter((name) => name !== "engine.ready");
    expect([...new Set(methods)].sort()).toEqual(["prompter.glass.snapshot", "prompter.layout.report"]);
    for (const word of [
      "engine_start",
      "engine_stop",
      "engine_summary",
      "shell_confirm_close",
      "shell_open_path",
      "pictures_place",
    ]) {
      expect(source.includes(word), word).toBe(false);
    }
  });
});

describe("glassLinkOver", () => {
  it("sends the same two requests over a transport that is there", async () => {
    const sent: string[] = [];
    let started = 0;
    const transport = {
      initialize: async () => {
        started += 1;
      },
      request: async (method: string) => {
        sent.push(method);
        return {};
      },
      subscribe: () => () => {},
    };
    const link = glassLinkOver(transport as unknown as Parameters<typeof glassLinkOver>[0]);
    await link.listen(() => {});
    await link.readGlass();
    await link.reportLayout({ layoutKey: "g1-l0", lines: [], endTop: 0 });
    await link.alive("no shell keeps this window");
    expect(sent).toEqual(["prompter.glass.snapshot", "prompter.layout.report"]);
    expect(started).toBe(1);
  });
});
