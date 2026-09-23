/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, JsonValue, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";
import { PREVIEW_AWARE_UI_METHODS, RECORDED_UI_METHODS, uiActions, type UiActionRow } from "./actionLog";

// The fixture double's Recent actions are the hardware link's action log
// (`native/rust-engine/src/action_log.rs`, production readiness Slice 11):
// every action the screen asks for that reaches a device leaves a row, with
// the hardware link's sentence, after it has been answered. Until 2026-09-22
// the double wrote a row for `lighting.output.setArmed` only.

const ACTION_LOG_RS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/action_log.rs"),
  "utf-8"
);

function rustMethodList(name: string): string[] {
  const match = ACTION_LOG_RS.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`));
  if (!match?.[1]) throw new Error(`${name} is not in action_log.rs any more`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!).sort();
}

const row = (domain: UiActionRow["domain"], action: string, target: string, detail: string): UiActionRow => ({
  domain,
  action,
  target,
  detail,
});

describe("the fixture double's action log", () => {
  it("records what the hardware link records, and leaves out what it stages", () => {
    expect([...RECORDED_UI_METHODS].sort()).toEqual(rustMethodList("RECORDED_UI_METHODS"));
    expect([...PREVIEW_AWARE_UI_METHODS].sort()).toEqual(rustMethodList("PREVIEW_AWARE_UI_METHODS"));
  });

  // Each sentence is `ui_actions`' own format string, filled in.
  const cases: Array<[RequestMethod, JsonObject, JsonValue, UiActionRow[]]> = [
    ["lighting.power.all", { on: false }, {}, [row("lighting", "all-off", "All lights", "All lights off")]],
    [
      "lighting.group.power",
      { groupId: "group-front", on: true },
      { groupName: "Front" },
      [row("lighting", "group-on", "Front", "Group Front on")],
    ],
    [
      "lighting.fixture.update",
      { fixtureId: "fixture-back", on: false, dmxStartAddress: 41 },
      { fixture: { name: "Back", universe: 1, dmxStartAddress: 41 } },
      [
        row("lighting", "light-off", "Back", "Back off"),
        row("lighting", "light-repatched", "Back", "Back repatched to U1 · 41"),
      ],
    ],
    ["lighting.fixture.update", { fixtureId: "fixture-back", intensity: 40 }, { fixture: { name: "Back" } }, []],
    [
      "lighting.fixture.create",
      { name: "Fixture 1" },
      { fixture: { name: "Fixture 1" } },
      [row("lighting", "light-added", "Fixture 1", "Fixture 1 added to the rig")],
    ],
    [
      "lighting.fixture.delete",
      { fixtureId: "fixture-key" },
      { deleted: true, fixtureId: "fixture-key" },
      [row("lighting", "light-removed", "fixture-key", "Light removed from the rig (fixture-key)")],
    ],
    [
      "lighting.scene.recall",
      { sceneId: "scene-interview", fadeMs: 2000 },
      { sceneName: "Interview", fadeDurationSeconds: 2 },
      [row("lighting", "scene-recalled", "Interview", "Scene recalled: Interview · 2.0 s fade")],
    ],
    [
      "lighting.scene.recall",
      { sceneId: "scene-warm-wash" },
      { sceneName: "Warm wash", fadeDurationSeconds: 0 },
      [row("lighting", "scene-recalled", "Warm wash", "Scene recalled: Warm wash")],
    ],
    [
      "lighting.palette.apply",
      { paletteId: "palette-intensity-half", fixtureIds: ["fixture-key", "fixture-fill"] },
      { paletteName: "Half", affectedFixtures: 2 },
      [row("lighting", "palette-applied", "Half", "Palette applied: Half · 2 light(s)")],
    ],
    [
      "lighting.settings.update",
      { enabled: true, bridgeIp: "10.1.0.1" },
      { bridgeIp: "10.1.0.1", universe: 1 },
      [
        row("lighting", "lighting-enabled", "Lighting", "Lighting switched on"),
        row("lighting", "bridge-address-set", "Bridge", "Bridge address set: 10.1.0.1 · universe 1"),
      ],
    ],
    ["lighting.settings.update", { selectedFixtureId: "fixture-key" }, {}, []],
    [
      "lighting.fixture.identify",
      { fixtureId: "fixture-back" },
      { fixtureId: "fixture-back" },
      [row("lighting", "identify", "fixture-back", "Identify flash (fixture-back)")],
    ],
    [
      "lighting.fixture.identifySequence",
      { fixtureIds: ["fixture-back", "fixture-key"], stepMs: 500, durationMs: 400 },
      { fixtureCount: 2 },
      [row("lighting", "identify-sequence", "Rig", "Identify sequence across 2 light(s)")],
    ],
    [
      "lighting.fixture.identify.clearAll",
      {},
      { clearedCount: 2 },
      [row("lighting", "identify-cleared", "Rig", "Identify flashes cleared")],
    ],
    [
      "lighting.fixture.highlight",
      { fixtureIds: ["fixture-key"], mode: "highlight" },
      { mode: "highlight", fixtureCount: 1 },
      [row("lighting", "highlight-on", "Rig", "Highlight on · 1 light(s)")],
    ],
    [
      "lighting.fixture.highlight",
      { fixtureIds: ["fixture-key", "fixture-fill"], mode: "solo" },
      { mode: "solo", fixtureCount: 2 },
      [row("lighting", "solo-on", "Rig", "Light solo on · 2 light(s)")],
    ],
    [
      "lighting.fixture.highlight",
      { fixtureIds: [], mode: "off" },
      { mode: "off", fixtureCount: 0 },
      [row("lighting", "highlight-off", "Rig", "Highlight and light solo off")],
    ],
    [
      "lighting.output.setArmed",
      { armed: false },
      { armed: false },
      [row("lighting", "outputs-held", "Light outputs", "Light outputs held")],
    ],
    [
      "audio.channel.update",
      { channelId: "audio-input-9", mute: true, phantom: false },
      { name: "Host" },
      [row("audio", "mute", "Host", "Mute on: Host"), row("audio", "phantom", "Host", "48 V off: Host")],
    ],
    ["audio.channel.update", { channelId: "audio-input-9", fader: 0.5 }, { name: "Host" }, []],
    [
      "audio.mixTarget.update",
      { mixTargetId: "audio-mix-main", dim: true },
      { name: "Main" },
      [row("audio", "dim", "Main", "Dim on: Main")],
    ],
    [
      "audio.channel.eq.update",
      { channelId: "audio-input-9", bandId: "band-2", bandEnabled: false },
      { name: "Host" },
      [row("audio", "eq-band", "Host", "EQ band band-2 off: Host")],
    ],
    [
      "audio.channel.dynamics.update",
      { channelId: "audio-input-9", section: "gate", enabled: true },
      { name: "Host" },
      [row("audio", "dynamics", "Host", "Dynamics (gate) on: Host")],
    ],
    [
      "audio.channel.send.update",
      { channelId: "audio-input-9", mixTargetId: "audio-mix-phones-a", mute: true },
      { name: "Host" },
      [row("audio", "send-mute", "Host", "Send mute on: Host to audio-mix-phones-a")],
    ],
    [
      "audio.snapshot.recall",
      { snapshotId: "audio-snapshot-1" },
      { snapshotName: "Show open" },
      [row("audio", "console-snapshot-recalled", "Show open", "Console mix recalled: Show open")],
    ],
    [
      "audio.talkback.hold",
      { mixTargetId: "audio-mix-main", engaged: true },
      { changed: true, talkback: true },
      [row("audio", "talkback-on", "Talkback", "Talkback on")],
    ],
    ["audio.talkback.hold", { mixTargetId: "audio-mix-main", engaged: true }, { changed: false, talkback: true }, []],
    ["audio.solo.clearAll", {}, {}, [row("audio", "solo-cleared", "Console", "Every solo cleared")]],
    [
      "audio.settings.update",
      { oscEnabled: false, sendPort: 7001 },
      { sendHost: "127.0.0.1", sendPort: 7001 },
      [
        row("audio", "console-control-off", "TotalMix", "TotalMix control switched off"),
        row("audio", "console-address-set", "TotalMix", "TotalMix address set: 127.0.0.1:7001"),
      ],
    ],
    [
      "commissioning.check.run",
      { target: "lighting", bridgeIp: "10.1.0.1" },
      {},
      [row("lighting", "bridge-address-set", "Bridge", "Bridge address set by the bridge probe: 10.1.0.1")],
    ],
    [
      "commissioning.check.run",
      { target: "audio", sendHost: "127.0.0.1" },
      {},
      [row("audio", "console-address-set", "TotalMix", "TotalMix address set by the audio probe: 127.0.0.1")],
    ],
    ["commissioning.check.run", { target: "audio" }, {}, []],
    [
      "support.backup.restore",
      { path: "native-backup.json" },
      { formatVersion: 4 },
      [row("setup", "backup-restored", "Saved data", "Backup archive restored: lighting and audio state replaced")],
    ],
    ["support.backup.restore", { path: "db-shutdown.sqlite3" }, { requiresRestart: true }, []],
  ];

  it.each(cases)("%s %j writes the hardware link's rows", (method, params, result, expected) => {
    expect(uiActions(method, params, result, false)).toEqual(expected);
  });

  it("covers every recorded method", () => {
    expect(new Set(cases.map(([method]) => method))).toEqual(new Set(RECORDED_UI_METHODS));
  });

  it("leaves no row for a change staged in the preview", () => {
    expect(uiActions("lighting.power.all", { on: true }, {}, true)).toEqual([]);
  });
});

describe("the fixture double writes the rows after an answered request", () => {
  const NOW = "2026-09-22T12:00:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function recentEvents(transport: ReturnType<typeof createFixtureTransport>) {
    const support = (await transport.request("support.snapshot", {})) as JsonObject;
    return (support.recentEvents ?? []) as JsonObject[];
  }

  it("newest first, from the screen, and nothing for a refusal or a staged change", async () => {
    const transport = createFixtureTransport(getFixtureScenario("lighting-populated"));
    expect(await recentEvents(transport)).toEqual([]);

    await transport.request("lighting.power.all", { on: false });
    expect(await recentEvents(transport)).toEqual([
      {
        id: 1,
        at: NOW,
        source: "ui",
        domain: "lighting",
        action: "all-off",
        target: "All lights",
        detail: "All lights off",
      },
    ]);

    await expect(transport.request("lighting.fixture.identify", { fixtureId: "fixture-gone" })).rejects.toThrow();
    await transport.request("lighting.editor.previewMode", { enabled: true });
    await transport.request("lighting.power.all", { on: true });
    await transport.request("lighting.editor.previewMode", { enabled: false });
    expect(await recentEvents(transport)).toHaveLength(1);

    await transport.request("lighting.fixture.highlight", { fixtureIds: ["fixture-key"], mode: "highlight" });
    await transport.request("lighting.fixture.update", { fixtureId: "fixture-back", on: true, dmxStartAddress: 45 });
    const rows = await recentEvents(transport);
    expect(rows.map((entry) => [entry.id, entry.detail])).toEqual([
      [4, "Back repatched to U1 · 45"],
      [3, "Back on"],
      [2, "Highlight on · 1 light(s)"],
      [1, "All lights off"],
    ]);
  });

  it("keeps the newest fifty", async () => {
    const transport = createFixtureTransport(getFixtureScenario("lighting-populated"));
    for (let press = 0; press < 60; press += 1) {
      await transport.request("lighting.power.all", { on: press % 2 === 0 });
    }
    const rows = await recentEvents(transport);
    expect(rows).toHaveLength(50);
    expect(rows[0]?.id).toBe(60);
    expect(rows[49]?.id).toBe(11);
  });

  it("carries on after the rows a scenario starts with", async () => {
    const transport = createFixtureTransport(getFixtureScenario("setup-ready"));
    const before = await recentEvents(transport);
    const newestId = Math.max(...before.map((entry) => Number(entry.id)));
    await transport.request("lighting.output.setArmed", { armed: false });
    const after = await recentEvents(transport);
    expect(after[0]).toMatchObject({ id: newestId + 1, source: "ui", detail: "Light outputs held" });
    expect(after.slice(1)).toEqual(before);
  });

  it("writes nothing while storage is refused at start, as the hardware link's recovery mode does", async () => {
    const transport = createFixtureTransport(getFixtureScenario("bootstrap-failed"));
    await transport.request("lighting.output.setArmed", { armed: false });
    expect(await recentEvents(transport)).toEqual([]);
  });
});
