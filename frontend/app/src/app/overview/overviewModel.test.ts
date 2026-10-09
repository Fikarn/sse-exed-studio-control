import { describe, expect, it } from "vitest";

import type {
  AudioSnapshot,
  CamerasSnapshot,
  LightingSnapshot,
  PrompterCue,
  PrompterGlassSummary,
  PrompterSnapshot,
} from "@sse/engine-client";
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

import { audioLatches } from "../audio/audioLatches";
import { buildAudioViewModel } from "../audio/audioViewModel";
import type { HeaderItem } from "../shellData";
import { standardLook } from "../teleprompter/glass/glassStoryScript";
import {
  cuesAhead,
  glassBand,
  lastSyncWord,
  overviewLatches,
  overviewState,
  placeParts,
  READY_SENTENCE,
  soundInputs,
  studioLinks,
  studioRows,
  takesTodayWord,
  type OverviewSources,
} from "./overviewModel";

// The Overview's model (D47): the worst page mirrored, the latches, the
// studio, the sound's inputs, the script's cues and band, the footer.

async function read<T>(fixtureId: string, method: string): Promise<T> {
  const transport = createFixtureTransport(getFixtureScenario(fixtureId));
  const answer = (await transport.request(method as never)) as unknown as T;
  await transport.dispose?.();
  return answer;
}

const audioViewModelOf = async (fixtureId: string) =>
  buildAudioViewModel({
    activeChannelGroups: { "hardware-inputs": [], "software-playback": [] },
    appSnapshot: null,
    audioSnapshot: await read<AudioSnapshot>(fixtureId, "audio.snapshot"),
    bankIndex: 0,
  });

function lamp(id: string, status: HeaderItem["status"], detail = status === "ok" ? "ready" : "attention"): HeaderItem {
  const tab = id === "prompter" ? "teleprompter" : id === "surface" || id === "backups" ? undefined : id;
  return { id, label: id, detail, status, ...(tab ? { tab } : {}) };
}

const allOk = () => ["lighting", "audio", "cameras", "prompter", "surface"].map((id) => lamp(id, "ok"));
const withLamp = (item: HeaderItem) => allOk().map((entry) => (entry.id === item.id ? item : entry));
const sources = (over: Partial<OverviewSources> = {}): OverviewSources => ({
  lamps: allOk(),
  audio: null,
  cameras: null,
  health: null,
  lighting: null,
  prompter: null,
  ...over,
});
const links = { answering: 8, total: 8 };

describe("the state display: the worst page", () => {
  it("reads READY while no lamp needs anything, and counts the links", () => {
    expect(overviewState(sources(), links)).toEqual({
      tone: "ok",
      word: "READY",
      sentence: READY_SENTENCE,
      meta: "8 of 8 links answer",
      wayOut: null,
      lamp: null,
      room: null,
    });
  });

  it("mirrors the Console's ASSUMED with its sentence, the Console named, and sends the Sync from here", async () => {
    const audio = await audioViewModelOf("audio-state-assumed");
    expect(audio.status.label).toBe("ASSUMED");
    const state = overviewState(sources({ lamps: withLamp(lamp("audio", "attention", "assumed")), audio }), links);
    expect(state).toMatchObject({
      tone: "attention",
      word: "ASSUMED",
      sentence: `Console: ${audio.status.warningBody}`,
      wayOut: { kind: "sync", label: "Sync from TotalMix" },
      lamp: "audio",
      room: "sound",
    });
  });

  it("mirrors CAM 1 not answering with the cameras' own words, and opens Cameras", async () => {
    const cameras = await read<CamerasSnapshot>("cameras-lost-mid-take", "cameras.snapshot");
    const state = overviewState(sources({ lamps: withLamp(lamp("cameras", "error", "unreachable")), cameras }), links);
    const cam1 = cameras.cameras.find((camera) => camera.camera === 1)!;
    expect(state).toMatchObject({
      tone: "error",
      word: cam1.word,
      sentence: `Cameras: ${cam1.sentence}`,
      wayOut: { kind: "open", page: "cameras", label: "Open Cameras" },
      room: "picture",
    });
  });

  it("puts an error before attention, and a tie in the take's order", () => {
    const both = allOk().map((item) =>
      item.id === "lighting"
        ? lamp("lighting", "error", "no output")
        : item.id === "cameras"
          ? lamp("cameras", "attention")
          : item
    );
    expect(overviewState(sources({ lamps: both }), links).lamp).toBe("lighting");
    const tie = allOk().map((item) =>
      item.id === "lighting" || item.id === "audio" || item.id === "prompter" ? lamp(item.id, "attention") : item
    );
    expect(overviewState(sources({ lamps: tie }), links).lamp).toBe("prompter");
  });

  it("keeps the lamp's word where the page's own state reads otherwise, and lights no room for the rig", async () => {
    const lighting = await read<LightingSnapshot>("lighting-populated", "lighting.snapshot");
    const state = overviewState(
      sources({
        lamps: withLamp(lamp("lighting", "error", "no output")),
        lighting: { ...lighting, reachable: true, outputArmed: true },
      }),
      links
    );
    expect(state).toMatchObject({
      tone: "error",
      word: "NO OUTPUT",
      wayOut: { kind: "open", page: "lighting", label: "Open Lighting" },
      room: null,
    });
    expect(state.sentence).toMatch(/^Lighting: /);
  });

  it("sends a held rig to Setup, where the outputs are armed, as Lighting does", async () => {
    const lighting = await read<LightingSnapshot>("lighting-populated", "lighting.snapshot");
    const held = { ...lighting, reachable: true, bridgeAnswering: true, outputArmed: false };
    const state = overviewState(
      sources({ lamps: withLamp(lamp("lighting", "attention", "held")), lighting: held }),
      links
    );
    expect(state).toMatchObject({ word: "HELD", wayOut: { kind: "open", page: "setup", label: "Open Setup" } });
  });

  it("names the deck and the backup, which have no page, and opens Setup", () => {
    const deck = overviewState(sources({ lamps: withLamp(lamp("surface", "attention", "no deck")) }), links);
    expect(deck).toMatchObject({ word: "NO DECK", wayOut: { kind: "open", page: "setup" }, room: null });
    expect(deck.sentence).toMatch(/^Deck: /);
    const backup = overviewState(sources({ lamps: [...allOk(), lamp("backups", "attention", "overdue")] }), links);
    expect(backup).toMatchObject({ word: "OVERDUE", wayOut: { kind: "open", page: "setup" } });
    expect(backup.sentence).toMatch(/^Backup: /);
  });

  it("counts the links: the rig, TotalMix, each camera set up, the Prompter XL, the deck and the pictures", async () => {
    const cameras = await read<CamerasSnapshot>("cameras-held", "cameras.snapshot");
    expect(studioLinks(allOk(), cameras)).toEqual({ answering: 8, total: 8 });
    const lost = await read<CamerasSnapshot>("cameras-lost-mid-take", "cameras.snapshot");
    expect(studioLinks(allOk(), lost).answering).toBeLessThan(8);
    expect(studioLinks(allOk(), null)).toEqual({ answering: 4, total: 4 });
  });
});

describe("the latches", () => {
  it("shows a held clip first, the strip named, then the Console's solo; two at most", async () => {
    const viewModel = await audioViewModelOf("audio-clipped");
    const lighting = await read<LightingSnapshot>("lighting-populated", "lighting.snapshot");
    const latches = overviewLatches(audioLatches(viewModel), {
      ...lighting,
      highlightFixtureIds: [lighting.fixtures[0]!.id],
    });
    expect(latches.map((latch) => latch.id)).toEqual(["audio-clip", "audio-solo"]);
    expect(latches[0]).toMatchObject({ who: "Clip", text: "1 over 0 dBFS · Guest 1" });
  });

  it("shows the rig's overlays with Off, its solo named the rig's", async () => {
    const lighting = await read<LightingSnapshot>("lighting-populated", "lighting.snapshot");
    const latches = overviewLatches([], { ...lighting, soloFixtureIds: [lighting.fixtures[0]!.id] });
    expect(latches).toEqual([
      {
        id: "lighting-solo",
        who: "Rig solo",
        text: lighting.fixtures[0]!.name,
        clear: { label: "Off", ariaLabel: "Solo off", locked: false, reason: "" },
      },
    ]);
  });
});

describe("the studio", () => {
  it("says what each page has set, one row each", async () => {
    const lighting = await read<LightingSnapshot>("lighting-populated", "lighting.snapshot");
    const audio = await audioViewModelOf("audio-state-assumed");
    const prompter = await read<PrompterSnapshot>("teleprompter-ready", "prompter.snapshot");
    const cameras = await read<CamerasSnapshot>("cameras-held", "cameras.snapshot");
    const rows = studioRows({
      lighting: { ...lighting, sceneState: "unsaved" },
      audio,
      prompter,
      cameras,
      picturesWord: "test pictures · 3 of 3",
      surface: lamp("surface", "ok", "ready"),
    });
    expect(rows.map((row) => row.id)).toEqual(["lighting", "console", "prompter", "pictures", "deck"]);
    expect(rows[0]).toMatchObject({ label: "Lighting", word: "unsaved", tone: "attention" });
    expect(rows[0]!.value).toMatch(/ · \d+ of \d+ lit$/);
    expect(rows[1]).toMatchObject({ label: "Console", word: "assumed", tone: "attention", doubt: true });
    expect(rows[2]).toMatchObject({ label: "Prompter XL", value: "1920×1080 · 60 Hz", word: "connected", tone: "ok" });
    expect(rows[3]).toMatchObject({ label: "Pictures", value: "test pictures · 3 of 3", word: "live" });
    expect(rows[4]).toMatchObject({ label: "Deck", value: "Stream Deck+", word: "ready", tone: "ok" });
  });
});

describe("the sound", () => {
  it("shows the hardware inputs TotalMix shows, never a playback pair or a hidden strip, four at most", () => {
    const strip = (id: string, role: string, hidden = false) => ({ id, role, hidden });
    const channels = [
      strip("in-1", "hardware-input", true),
      strip("in-9", "hardware-input"),
      strip("pb-1", "playback-pair"),
      strip("in-10", "hardware-input"),
      strip("in-11", "hardware-input"),
      strip("in-12", "hardware-input"),
      strip("in-13", "hardware-input"),
    ];
    expect(soundInputs(channels).map((channel) => channel.id)).toEqual(["in-9", "in-10", "in-11", "in-12"]);
  });
});

describe("the script", () => {
  const cue = (paragraph: number, secondsAhead: number | null, text = `cue ${paragraph}`): PrompterCue => ({
    paragraph,
    word: 0,
    text,
    secondsAhead,
  });
  const glass = (over: Partial<PrompterGlassSummary> = {}) =>
    ({
      place: { paragraph: 7, word: 3 },
      paragraphCount: 18,
      atEnd: false,
      cues: [cue(3, -40), cue(8, 10.4), cue(11, 55), cue(13, 98), cue(16, 140)],
      ...over,
    }) as PrompterGlassSummary;

  it("counts the cues ahead down from the hardware link's report, three of them", () => {
    expect(cuesAhead(glass(), 0).map((entry) => [entry.paragraph, entry.time])).toEqual([
      [8, "0:10"],
      [11, "0:55"],
      [13, "1:38"],
    ]);
    // Eleven seconds later the first has passed the reading line.
    expect(cuesAhead(glass(), 11).map((entry) => entry.paragraph)).toEqual([11, 13, 16]);
  });

  it("lists the cues after the place, with no time, before the glass is laid out", () => {
    const unlaid = glass({ cues: [cue(3, null), cue(8, null), cue(11, null)] });
    expect(cuesAhead(unlaid, 0)).toEqual([
      { paragraph: 8, text: "cue 8", seconds: null, time: "—" },
      { paragraph: 11, text: "cue 11", seconds: null, time: "—" },
    ]);
  });

  it("prints the place in two parts, and END at the end", () => {
    expect(placeParts(glass(), 0.437)).toEqual({ paragraph: "¶ 8 of 18", share: "43 %" });
    expect(placeParts(glass({ atEnd: true }), 1)).toEqual({ paragraph: "END", share: "100 %" });
  });

  it("crops the glass to its column and stands its reading line at the glass's own share of the band", () => {
    const band = glassBand({ look: standardLook(), sizePx: 88, paragraphs: [] }, { width: 880, height: 332 });
    // The standard look: the column 230.4 px in, the arrow 110 px before it.
    expect(band.scale).toBeCloseTo(880 / 1609.2, 4);
    expect(band.width).toBeCloseTo(1920 * band.scale, 6);
    expect(band.left).toBeCloseTo(-110.4 * band.scale, 4);
    expect(band.readingLine).toBeCloseTo(332 * 0.35, 6);
    expect(band.top + 378 * band.scale).toBeCloseTo(band.readingLine, 6);
  });
});

describe("the footer", () => {
  it("counts the day's takes in minutes", () => {
    expect(takesTodayWord({ count: 4, recordedSeconds: 2460 })).toBe("4 · 41 min");
    expect(takesTodayWord({ count: 0, recordedSeconds: 0 })).toBe("none yet");
    expect(takesTodayWord(null)).toBe("not read");
  });

  it("says when the Console was last synced, today by the clock alone", () => {
    const now = new Date(2026, 9, 9, 10, 42);
    expect(lastSyncWord({ lastConsoleSyncAt: new Date(2026, 9, 9, 9, 14).toISOString() }, now)).toBe("09:14");
    expect(lastSyncWord({ lastConsoleSyncAt: new Date(2026, 9, 8, 16, 2).toISOString() }, now)).toBe("8 Oct 16:02");
    expect(lastSyncWord({ lastConsoleSyncAt: null }, now)).toBe("none since the start");
  });
});
