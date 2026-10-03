import { describe, expect, it } from "vitest";

import { buildMonitorItems, deriveLightingWorkspaceTone, headerItems, recChipOf, withRestoreDetail } from "./shellData";

// New pages program, Slice 2 (D3): a restore's `detail` (the hardware link's
// note that a backup's Planning data was not restored) follows the shell's
// sentence; anything that is not a sentence adds nothing.
describe("a restore's detail", () => {
  it("follows the shell's sentence when the reply carries one", () => {
    expect(withRestoreDetail("Restored.", { detail: "Planning data in this backup was not restored." })).toBe(
      "Restored. Planning data in this backup was not restored."
    );
  });

  it("adds nothing without a sentence", () => {
    expect(withRestoreDetail("Restored.", null)).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { restored: true })).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { detail: "  " })).toBe("Restored.");
    expect(withRestoreDetail("Restored.", { detail: 4 })).toBe("Restored.");
  });
});

// Found, to check (2026-09-28): the deck's probe always passed. Since
// 2026-09-29 the hardware link says `quiet` while the deck has not asked its
// bridge lately, and the Surface lamp reads `no deck`, amber.
describe("the Surface lamp and a quiet deck", () => {
  const surfaceLamp = (status: string) =>
    buildMonitorItems({ checks: { controlSurface: { status } } }).find((item) => item.id === "surface");

  it("reads no deck, amber, while the deck is quiet", () => {
    expect(surfaceLamp("quiet")).toMatchObject({ detail: "no deck", status: "attention" });
  });

  it("reads ready while it asks, and unavailable in red when the bridge could not open", () => {
    expect(surfaceLamp("ready")).toMatchObject({ detail: "ready", status: "ok" });
    expect(surfaceLamp("unavailable")).toMatchObject({ detail: "unavailable", status: "error" });
  });
});

// 2026-09 production readiness, Slice 11 (F31): the header's Lighting lamp
// says `held` while the light outputs are held — on every workspace, because
// the header is on every workspace.

function lightingLamp(healthStatus: string | undefined, lighting: ReturnType<typeof deriveLightingWorkspaceTone>) {
  const health = healthStatus ? { checks: { lighting: { status: healthStatus } } } : null;
  const lamp = buildMonitorItems(health, undefined, { lighting }).find((item) => item.id === "lighting");
  if (!lamp) {
    throw new Error("the Lighting lamp is missing");
  }
  return { detail: lamp.detail, status: lamp.status };
}

describe("the Lighting lamp and held light outputs", () => {
  it("only an explicit false is a hold", () => {
    expect(deriveLightingWorkspaceTone(null, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ reachable: true }, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false)).toEqual({
      tone: "attention",
      winsTies: true,
      word: "held",
    });
  });

  it("no bridge outranks a hold, and a hold outranks an unsaved scene", () => {
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: false }, true)?.word).toBe("no bridge");
    expect(deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, true)?.word).toBe("held");
    expect(deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, true)?.word).toBe("unsaved");
  });

  it("says held over a healthy bridge, in the attention tone", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    expect(lightingLamp("ok", held)).toEqual({ detail: "held", status: "attention" });
  });

  it("says held when the health check is at attention too — the tie an unsaved scene loses", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    expect(lightingLamp("attention", held)).toEqual({ detail: "held", status: "attention" });
    expect(lightingLamp(undefined, held)).toEqual({ detail: "held", status: "attention" });

    const unsaved = deriveLightingWorkspaceTone({ outputArmed: true, reachable: true }, true);
    expect(lightingLamp("attention", unsaved).detail).not.toBe("unsaved");
  });

  // 2026-09-29: the bridge watch's word, amber, outranks a hold.
  it("says not answering when the watch says the bridge went silent, and only then", () => {
    const silent = deriveLightingWorkspaceTone({ bridgeAnswering: false, outputArmed: false, reachable: true }, true);
    expect(silent).toEqual({ tone: "attention", winsTies: true, word: "not answering" });
    expect(lightingLamp("ok", silent)).toEqual({ detail: "not answering", status: "attention" });
    expect(deriveLightingWorkspaceTone({ bridgeAnswering: false, reachable: false }, false)?.word).toBe("no bridge");
    expect(deriveLightingWorkspaceTone({ bridgeAnswering: null, reachable: true }, false)).toBeNull();
    expect(deriveLightingWorkspaceTone({ bridgeAnswering: true, reachable: true }, false)).toBeNull();
  });

  it("leaves an error to the health check", () => {
    const held = deriveLightingWorkspaceTone({ outputArmed: false, reachable: true }, false);
    const lamp = lightingLamp("error", held);
    expect(lamp.status).toBe("error");
    expect(lamp.detail).not.toBe("held");
  });
});

// 2026-09-21: the header lamps must read the hardware link's own health words.
// The fixture double said `ok` / `attention` until 2026-09-22; the engine says `ready`,
// `not-verified`, `attention` (audio and lighting, which also say
// `unconfigured` / `disabled`) and `ready` / `unavailable` (the Stream Deck
// bridge, `native/rust-engine/src/control_surface_http.rs`). Only the fixture's
// words were mapped, so on the workstation a verified Audio, a probed Lighting
// and a serving Deck all showed a yellow "pending". These cases are written in
// the engine's words, from `audio/snapshot.rs`, `lighting/snapshot.rs` and
// `control_surface_http.rs`, not from what the header happens to produce.
describe("the header lamps read the hardware link's own words", () => {
  function lamps(checks: Record<string, { status: string }>) {
    const items = buildMonitorItems({ checks }, undefined, undefined);
    const byId = (id: string) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) throw new Error(`the ${id} lamp is missing`);
      return { detail: item.detail, status: item.status };
    };
    return { audio: byId("audio"), lighting: byId("lighting"), deck: byId("surface") };
  }

  it("a subsystem the hardware link calls ready is ready and green, never pending", () => {
    const healthy = lamps({
      audio: { status: "ready" },
      lighting: { status: "ready" },
      controlSurface: { status: "ready" },
    });
    expect(healthy.audio).toEqual({ detail: "ready", status: "ok" });
    expect(healthy.lighting).toEqual({ detail: "ready", status: "ok" });
    expect(healthy.deck).toEqual({ detail: "ready", status: "ok" });
  });

  it("a probe that has not run says so, in the attention tone", () => {
    const unprobed = lamps({ audio: { status: "not-verified" }, lighting: { status: "not-verified" } });
    expect(unprobed.audio).toEqual({ detail: "not verified", status: "attention" });
    expect(unprobed.lighting).toEqual({ detail: "not verified", status: "attention" });
  });

  it("lighting that is not set up or is switched off says which", () => {
    expect(lamps({ lighting: { status: "unconfigured" } }).lighting).toEqual({
      detail: "not set up",
      status: "attention",
    });
    expect(lamps({ lighting: { status: "disabled" } }).lighting).toEqual({
      detail: "disabled",
      status: "attention",
    });
  });

  it("a Stream Deck bridge that could not start is an error", () => {
    expect(lamps({ controlSurface: { status: "unavailable" } }).deck).toEqual({
      detail: "unavailable",
      status: "error",
    });
  });

  it("a failed probe is still attention, and a missing check is still pending", () => {
    expect(lamps({ audio: { status: "attention" } }).audio).toEqual({ detail: "attention", status: "attention" });
    expect(lamps({}).audio).toEqual({ detail: "pending", status: "attention" });
    expect(lamps({}).deck).toEqual({ detail: "pending", status: "attention" });
  });

  it("the older words `ok` / `attention` keep what they showed", () => {
    const fixture = lamps({
      audio: { status: "ok" },
      lighting: { status: "attention" },
      controlSurface: { status: "ok" },
    });
    expect(fixture.audio).toEqual({ detail: "ready", status: "ok" });
    expect(fixture.lighting).toEqual({ detail: "attention", status: "attention" });
    expect(fixture.deck).toEqual({ detail: "ready", status: "ok" });
  });
});

// New pages program, Slice 6a: the Teleprompter in the header — its lamp from
// `checks.prompter` before the deck's, the deck's lamp called Surface (D19),
// and the green latch while the prompter scrolls.
describe("the header's Prompter lamp, Surface lamp and playing latch", () => {
  const byId = (items: ReturnType<typeof buildMonitorItems>, id: string) => items.find((item) => item.id === id);

  it("orders the lamps as the tabs with the deck last, and calls the deck's lamp Surface", () => {
    const items = buildMonitorItems({ checks: {} }, undefined, undefined);
    expect(items.map((item) => item.label)).toEqual(["Lighting", "Audio", "Cameras", "Prompter", "Surface"]);
  });

  it("reads the Prompter lamp from checks.prompter in the hardware link's word", () => {
    const lamp = (prompter: unknown) =>
      byId(buildMonitorItems({ checks: { prompter } } as never, undefined, undefined), "prompter");
    expect(lamp({ status: "ok", word: "CONNECTED" })).toMatchObject({ detail: "ready", status: "ok" });
    expect(lamp({ status: "error", word: "NOT CONNECTED" })).toMatchObject({
      detail: "not connected",
      status: "error",
    });
    expect(lamp({ status: "attention", word: "NOT UPDATED" })).toMatchObject({
      detail: "not updated",
      status: "attention",
    });
    // Absent, or `null` when the hardware link could not read it: pending, as the other lamps before a check.
    expect(lamp(undefined)).toMatchObject({ detail: "pending", status: "attention" });
    expect(lamp(null)).toMatchObject({ detail: "pending", status: "attention" });
  });

  // The shell (overhaul 3): while the prompter scrolls, the Teleprompter
  // tab's own lamp says `playing` with the time left in PT Sans, unless the
  // prompter is worse off. Old: a green `Prompter playing` latch of its own.
  it("says playing with the time left on the prompter's lamp while it scrolls, unless it is worse off", () => {
    const ready = { checks: { prompter: { status: "ok", word: "ON SCREEN" } } };
    const playing = buildMonitorItems(ready, { lightingSceneDrift: false, audioSolo: false, prompterPlaying: "3:12" });
    expect(byId(playing, "prompter")).toEqual({
      id: "prompter",
      label: "Prompter",
      detail: "playing",
      value: "3:12 left",
      status: "ok",
      tab: "teleprompter",
    });
    expect(byId(playing, "latched:prompter-playing")).toBeUndefined();
    const paused = buildMonitorItems(ready, { lightingSceneDrift: false, audioSolo: false, prompterPlaying: null });
    expect(byId(paused, "prompter")).toMatchObject({ detail: "ready", status: "ok" });
    expect(byId(paused, "prompter")?.value).toBeUndefined();
    const lost = buildMonitorItems(
      { checks: { prompter: { status: "error", word: "NOT CONNECTED" } } },
      { lightingSceneDrift: false, audioSolo: false, prompterPlaying: "3:12" }
    );
    expect(byId(lost, "prompter")).toMatchObject({ detail: "not connected", status: "error" });
  });
});

// The cameras in the header: their lamp from `checks.cameras`, in the hardware
// link's word, and the `REC` chip, which reads CAM 1's state there.
describe("the header's Cameras lamp and REC chip", () => {
  const byId = (items: ReturnType<typeof buildMonitorItems>, id: string) => items.find((item) => item.id === id);
  const camera = (number: number, state: string) => ({ camera: number, tag: `CAM ${number}`, state });
  const check = (status: string, word: string, recording: boolean, main: string) => ({
    status,
    word,
    recording,
    cameras: [camera(1, main), camera(2, "held"), camera(3, "held")],
  });

  it("reads the lamp from checks.cameras in the hardware link's word", () => {
    const lamp = (cameras: unknown) =>
      byId(buildMonitorItems({ checks: { cameras } } as never, undefined, undefined), "cameras");
    expect(lamp(check("ok", "HELD", false, "held"))).toMatchObject({ detail: "ready", status: "ok" });
    expect(lamp(check("attention", "RELEASED", false, "held"))).toMatchObject({
      detail: "released",
      status: "attention",
    });
    expect(lamp(check("attention", "NOT SET UP", false, "not-set-up"))).toMatchObject({
      detail: "not set up",
      status: "attention",
    });
    expect(lamp(check("error", "UNREACHABLE", false, "held"))).toMatchObject({
      detail: "unreachable",
      status: "error",
    });
    expect(lamp(undefined)).toMatchObject({ detail: "pending", status: "attention" });
    expect(lamp(null)).toMatchObject({ detail: "pending", status: "attention" });
  });

  it("shows REC red while CAM 1 is held and reports recording, and not otherwise", () => {
    expect(recChipOf(check("ok", "HELD", true, "held"))).toEqual({ detail: "CAM 1", status: "error" });
    expect(recChipOf(check("ok", "HELD", false, "held"))).toBeNull();
    expect(recChipOf(check("attention", "NOT SET UP", false, "not-set-up"))).toBeNull();
    expect(recChipOf(undefined)).toBeNull();
    expect(recChipOf(null)).toBeNull();
    expect(recChipOf({ status: "ok", recording: true })).toBeNull();
  });

  it("shows REC amber, last known, when CAM 1 does not answer and last reported recording", () => {
    expect(recChipOf(check("error", "UNREACHABLE", true, "unreachable"))).toEqual({
      detail: "last known",
      status: "attention",
    });
    expect(recChipOf(check("error", "UNREACHABLE", false, "unreachable"))).toBeNull();
  });

  it("shows REC amber whenever CAM 1 is released: it is not read", () => {
    expect(recChipOf(check("attention", "RELEASED", false, "released"))).toEqual({
      detail: "not read while released",
      status: "attention",
    });
  });

  it("puts the chip last, after the other latches, and it opens the Cameras page", () => {
    const items = buildMonitorItems({ checks: { cameras: check("ok", "HELD", true, "held") } } as never, {
      lightingSceneDrift: true,
      audioSolo: true,
      prompterPlaying: "3:12",
    });
    expect(items.map((item) => item.id).slice(-3)).toEqual(["latched:scene-drift", "latched:solo", "latched:rec"]);
    expect(byId(items, "latched:rec")).toEqual({
      id: "latched:rec",
      label: "REC",
      detail: "CAM 1",
      status: "error",
      target: "Cameras",
      page: "cameras",
      doubt: false,
    });
  });

  it("marks a last known REC as a doubt", () => {
    const items = buildMonitorItems({
      checks: { cameras: check("error", "UNREACHABLE", true, "unreachable") },
    } as never);
    expect(byId(items, "latched:rec")).toMatchObject({ detail: "last known", doubt: true });
  });
});

// The shell (overhaul 3): what the header shows on each page.
describe("the header on each page", () => {
  const camera = (number: number, state: string) => ({ camera: number, tag: `CAM ${number}`, state });
  const recording = {
    checks: {
      cameras: { status: "ok", word: "HELD", recording: true, cameras: [camera(1, "held")] },
      lighting: { status: "ready" },
    },
  };
  const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

  it("keeps REC in its own slot on every page, Cameras included", () => {
    const items = buildMonitorItems(recording as never, { lightingSceneDrift: false, audioSolo: false });
    for (const page of ["setup", "lighting", "audio", "cameras", "teleprompter"]) {
      const header = headerItems(items, page);
      expect(header.rec?.id, page).toBe("latched:rec");
      expect(ids(header.lamps), page).not.toContain("latched:rec");
    }
    expect(headerItems(buildMonitorItems({ checks: {} }), "audio").rec).toBeNull();
  });

  it("leaves a latch off the page that shows it itself: Solo on Audio, the drifted scene on Lighting", () => {
    const items = buildMonitorItems(
      recording as never,
      { lightingSceneDrift: true, audioSolo: true },
      {
        lighting: { tone: "attention", winsTies: true, word: "held" },
      }
    );
    expect(ids(headerItems(items, "audio").lamps)).not.toContain("latched:solo");
    expect(ids(headerItems(items, "audio").lamps)).toContain("latched:scene-drift");
    expect(ids(headerItems(items, "lighting").lamps)).not.toContain("latched:scene-drift");
    expect(ids(headerItems(items, "lighting").lamps)).toContain("latched:solo");
    expect(ids(headerItems(items, "setup").lamps)).toEqual(
      expect.arrayContaining(["latched:scene-drift", "latched:solo"])
    );
  });

  it("prints the drifted scene once: not as a latch when the Lighting tab already says unsaved", () => {
    const items = buildMonitorItems(
      recording as never,
      { lightingSceneDrift: true, audioSolo: false },
      {
        lighting: deriveLightingWorkspaceTone({ reachable: true, outputArmed: true }, true),
      }
    );
    expect(items.find((item) => item.id === "lighting")?.detail).toBe("unsaved");
    expect(ids(headerItems(items, "audio").lamps)).not.toContain("latched:scene-drift");
  });
});

// Found, to check (2026-09-28): a light output that could not open its port,
// and an automatic backup that failed or is two days old, lit no lamp. The
// hardware link reports both in `checks.engine`.
describe("the header says what fails in the background", () => {
  const NOW_MS = Date.UTC(2026, 8, 28, 12, 0, 0);
  const nowSecs = NOW_MS / 1000;
  const health = (engine: Record<string, { state: string; detail?: string; at: number }>) =>
    ({ checks: { lighting: { status: "ready" }, engine } }) as unknown as Parameters<typeof buildMonitorItems>[0];
  const item = (items: ReturnType<typeof buildMonitorItems>, id: string) => items.find((entry) => entry.id === id);

  it("a light output that could not open reads no output, above held and no bridge", () => {
    const failed = health({ sacn: { state: "attention", at: nowSecs } });
    const held = { lighting: { tone: "attention" as const, winsTies: true, word: "held" } };
    for (const tones of [undefined, held, { lighting: { tone: "error" as const, word: "no bridge" } }]) {
      expect(item(buildMonitorItems(failed, undefined, tones, NOW_MS), "lighting")).toMatchObject({
        detail: "no output",
        status: "error",
      });
    }
    expect(
      item(buildMonitorItems(health({ sacn: { state: "ok", at: nowSecs } }), undefined, held, NOW_MS), "lighting")
    ).toMatchObject({ detail: "held" });
  });

  it("a failed backup is a chip after the five lamps, and an old one reads overdue", () => {
    const failed = buildMonitorItems(
      health({ backups: { state: "warning", at: nowSecs - 60 } }),
      undefined,
      undefined,
      NOW_MS
    );
    expect(failed.map((entry) => entry.id)).toEqual(["lighting", "audio", "cameras", "prompter", "surface", "backups"]);
    expect(item(failed, "backups")).toMatchObject({ label: "Backup", detail: "failed", status: "attention" });

    const overdue = buildMonitorItems(
      health({ backups: { state: "warning", at: nowSecs - 49 * 3600 } }),
      undefined,
      undefined,
      NOW_MS
    );
    expect(item(overdue, "backups")?.detail).toBe("overdue");

    for (const state of ["ok", "attention"]) {
      expect(
        item(buildMonitorItems(health({ backups: { state, at: nowSecs } }), undefined, undefined, NOW_MS), "backups")
      ).toBeUndefined();
    }
    expect(buildMonitorItems(null, undefined, undefined, NOW_MS)).toHaveLength(5);
  });
});
