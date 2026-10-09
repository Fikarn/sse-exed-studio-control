import type {
  AudioSnapshot,
  CamerasSnapshot,
  JsonObject,
  LightingSnapshot,
  PrompterCue,
  PrompterGlassSummary,
  PrompterSnapshot,
  WorkspaceId,
} from "@sse/engine-client";

import { audioWayOut, type AudioLatchView } from "../audio/audioLatches";
import type { AudioWorkspaceViewModel } from "../audio/audioViewModel";
import { camerasStateView } from "../cameras/camerasModel";
import { lightingLatches } from "../lighting/lightingLatches";
import { deriveLightingState, lightingStateInputOf, liveSceneOf } from "../lighting/lightingState";
import type { HeaderItem } from "../shellData";
import { glassMetrics, GLASS_WIDTH } from "../teleprompter/glass/glassLayout";
import type { PrompterGlassText } from "../teleprompter/glass/PrompterGlass";
import { formatDuration } from "../teleprompter/prompterTime";
import { prompterCheckOf, prompterStateView } from "../teleprompter/teleprompterModel";

// The Overview's model (D47, board 3): what the page shows, read from the
// same snapshots the pages read and the header's own lamps, in pure
// functions so the page's logic is tested without a browser. The page adds
// no state words of its own: the state display mirrors the worst page.

export type OverviewTone = "ok" | "attention" | "error";
/** The rooms that hold a page's facts; Lighting and the system have none. */
export type OverviewRoom = "picture" | "script" | "sound";
/** The keyline a room takes from the state display. */
export type OverviewAlert = "error" | "attention";

export type OverviewWayOut =
  /** The Console's own way out, sent from here: it is one press on the Console too. */
  | { kind: "sync"; label: "Sync from TotalMix" }
  /** Every other way out opens the page that has it. */
  | { kind: "open"; page: WorkspaceId; label: string };

export interface OverviewState {
  tone: OverviewTone;
  word: string;
  /** The page's own sentence, the page named first (`Cameras: …`). */
  sentence: string;
  meta: string | null;
  wayOut: OverviewWayOut | null;
  /** The lamp the display mirrors (`cameras`, `audio`, …); `null` at READY. */
  lamp: string | null;
  /** The room that takes the display's keyline. */
  room: OverviewRoom | null;
}

/** The header's lamps the Overview ranks, in the order a tie goes: the take's order. */
const RANKED = ["cameras", "prompter", "audio", "lighting", "surface", "backups"] as const;
type RankedLamp = (typeof RANKED)[number];

/** How a sentence names its page: the tab's word, but the Console for Audio, as the board does. */
const PAGE_NAME: Record<RankedLamp, string> = {
  cameras: "Cameras",
  prompter: "Prompter",
  audio: "Console",
  lighting: "Lighting",
  surface: "Deck",
  backups: "Backup",
};

const ROOM: Partial<Record<RankedLamp, OverviewRoom>> = { cameras: "picture", prompter: "script", audio: "sound" };

const OPEN: Record<RankedLamp, OverviewWayOut> = {
  cameras: { kind: "open", page: "cameras", label: "Open Cameras" },
  prompter: { kind: "open", page: "teleprompter", label: "Open Teleprompter" },
  audio: { kind: "open", page: "audio", label: "Open Audio" },
  lighting: { kind: "open", page: "lighting", label: "Open Lighting" },
  surface: { kind: "open", page: "setup", label: "Open Setup" },
  backups: { kind: "open", page: "setup", label: "Open Setup" },
};

const SYNC: OverviewWayOut = { kind: "sync", label: "Sync from TotalMix" };

export const READY_SENTENCE = "Every link answers. Nothing on any page needs you.";

/** A page's own state, as its state display shows it. */
interface PageState {
  tone: OverviewTone | "info";
  word: string;
  sentence: string;
  meta: string | null;
  wayOut: OverviewWayOut | null;
}

export interface OverviewSources {
  /** The header's items before the header leaves any out (`buildMonitorItems`). */
  lamps: readonly HeaderItem[];
  audio: Pick<AudioWorkspaceViewModel, "appSummary" | "status"> | null;
  cameras: CamerasSnapshot | null;
  health: JsonObject | null;
  lighting: LightingSnapshot | null;
  prompter: PrompterSnapshot | null;
}

const severity = (tone: string) => (tone === "error" ? 2 : tone === "attention" ? 1 : 0);

function pageState(lamp: RankedLamp, sources: OverviewSources): PageState | null {
  switch (lamp) {
    case "cameras": {
      const view = sources.cameras ? camerasStateView(sources.cameras) : null;
      return view ? { ...view, wayOut: OPEN.cameras } : null;
    }
    case "prompter": {
      if (!sources.prompter) return null;
      const view = prompterStateView(
        sources.prompter,
        prompterCheckOf(sources.health),
        sources.prompter.scripts.length > 0
      );
      return { ...view, wayOut: OPEN.prompter };
    }
    case "audio": {
      if (!sources.audio) return null;
      const { status, appSummary } = sources.audio;
      const way = audioWayOut(status.label);
      return {
        tone: status.tone,
        word: status.label,
        sentence: status.warningBody ?? appSummary,
        meta: null,
        wayOut: way === "sync" || way === "failed" ? SYNC : OPEN.audio,
      };
    }
    case "lighting": {
      if (!sources.lighting) return null;
      const input = lightingStateInputOf(sources.lighting);
      const state = deriveLightingState(input);
      // Lighting's own way out of a bridge it cannot reach, or of outputs held, is Setup.
      const toSetup =
        state.word === "UNREACHABLE" || state.word === "HELD" || (state.word === "NOT ANSWERING" && input.outputsHeld);
      return {
        ...state,
        wayOut: toSetup ? { kind: "open", page: "setup", label: "Open Setup" } : OPEN.lighting,
      };
    }
    default:
      return null;
  }
}

/** The health check's own sentence for a lamp, when it fits the display's two lines. */
function checkSentence(lamp: RankedLamp, health: JsonObject | null): string | null {
  const key = lamp === "surface" ? "controlSurface" : lamp === "backups" ? null : lamp;
  if (!key) return null;
  const checks = health?.checks;
  const check = checks && typeof checks === "object" && !Array.isArray(checks) ? (checks as JsonObject)[key] : null;
  const summary = check && typeof check === "object" && !Array.isArray(check) ? (check as JsonObject).summary : null;
  return typeof summary === "string" && summary.length <= 70 ? summary : null;
}

/** What a lamp with no page of its own, or whose page reads otherwise, says. */
function lampSentence(lamp: RankedLamp, item: HeaderItem, health: JsonObject | null): string {
  const own = checkSentence(lamp, health);
  if (own) return own;
  if (lamp === "backups") return `The last backup is ${item.detail}. Setup / Support has the backups.`;
  if (lamp === "surface") return `The deck reads ${item.detail}. Setup / Support says why.`;
  return `Its lamp reads ${item.detail}. The page says why.`;
}

/**
 * The studio's state, mirrored from the worst page (the board's note 2): the
 * header's lamps ranked, an error before attention, a tie in the take's
 * order (CAM 1's take, the prompter, the Console, the rig, the deck, the
 * backup); that page's own word and sentence, the page named first, and its
 * way out. Where the page's own state reads otherwise than its lamp (a lamp
 * also reads the hardware link's health), the lamp's word stands, with the
 * health check's sentence. `READY` while no lamp needs anything.
 */
export function overviewState(sources: OverviewSources, links: { answering: number; total: number }): OverviewState {
  let worst: { lamp: RankedLamp; item: HeaderItem } | null = null;
  for (const lamp of RANKED) {
    const item = sources.lamps.find((entry) => entry.id === lamp);
    if (!item || severity(item.status) === 0) continue;
    if (!worst || severity(item.status) > severity(worst.item.status)) worst = { lamp, item };
  }
  if (!worst) {
    return {
      tone: "ok",
      word: "READY",
      sentence: READY_SENTENCE,
      meta: `${links.answering} of ${links.total} links answer`,
      wayOut: null,
      lamp: null,
      room: null,
    };
  }
  const { lamp, item } = worst;
  const tone = item.status as OverviewTone;
  const page = pageState(lamp, sources);
  const own = page && page.tone === tone ? page : null;
  return {
    tone,
    word: own ? own.word : item.detail.toUpperCase(),
    sentence: `${PAGE_NAME[lamp]}: ${own ? own.sentence : lampSentence(lamp, item, sources.health)}`,
    meta: own?.meta ?? null,
    wayOut: own?.wayOut ?? (lamp === "audio" ? OPEN.audio : OPEN[lamp]),
    lamp,
    room: ROOM[lamp] ?? null,
  };
}

/**
 * The links the studio holds, for the READY meta (`8 of 8 links answer`):
 * the rig's bridge, TotalMix, each camera set up, the Prompter XL, the deck
 * and the pictures.
 */
export function studioLinks(lamps: readonly HeaderItem[], cameras: CamerasSnapshot | null) {
  const ok = (id: string) => lamps.find((item) => item.id === id)?.status === "ok";
  const setUp = cameras?.cameras.filter((camera) => camera.state !== "not-set-up") ?? [];
  const held = setUp.filter((camera) => camera.state === "held").length;
  // The pictures are a link of their own once a camera is set up: vMix's, not the cameras'.
  const pictures = setUp.length > 0 ? 1 : 0;
  const picturesAnswer = pictures > 0 && cameras?.pictures.state === "showing" ? 1 : 0;
  const answering =
    [ok("lighting"), ok("audio"), ok("prompter"), ok("surface")].filter(Boolean).length + held + picturesAnswer;
  return { answering, total: 4 + setUp.length + pictures };
}

// ---------------------------------------------------------------------------
// The latches: every page's, in the one latch slot (the board's note 3)
// ---------------------------------------------------------------------------

export interface OverviewLatch {
  id: "audio-clip" | "audio-solo" | "lighting-highlight" | "lighting-solo";
  who: string;
  /** What it holds, the strips or fixtures named. */
  text: string;
  clear: { label: string; ariaLabel: string; locked: boolean; reason: string };
}

/**
 * The latches, a held clip first (it is the take's), then the Console's solo,
 * then the rig's overlays; the slot has room for two, so the first two show.
 */
export function overviewLatches(audio: readonly AudioLatchView[], lighting: LightingSnapshot | null): OverviewLatch[] {
  const clip = audio.find((latch) => latch.id === "clip");
  const solo = audio.find((latch) => latch.id === "solo");
  const latches: OverviewLatch[] = [];
  if (clip)
    latches.push({
      id: "audio-clip",
      who: clip.who,
      text: `${clip.text} · ${clip.names.join(", ")}`,
      clear: clip.clear,
    });
  if (solo) latches.push({ id: "audio-solo", who: solo.who, text: solo.text, clear: solo.clear });
  for (const latch of lightingLatches(lighting)) {
    latches.push({
      id: latch.id === "highlight" ? "lighting-highlight" : "lighting-solo",
      // Beside the Console's, the rig's solo says whose it is, as the header does on Lighting.
      who: latch.id === "solo" ? "Rig solo" : latch.who,
      text: latch.text,
      clear: { label: "Off", ariaLabel: `${latch.who} off`, locked: false, reason: "" },
    });
  }
  return latches.slice(0, 2);
}

// ---------------------------------------------------------------------------
// The studio: what each page has set, one row each (the board's note 5)
// ---------------------------------------------------------------------------

export interface StudioRow {
  id: "lighting" | "console" | "prompter" | "pictures" | "deck";
  label: string;
  value: string;
  word: string;
  tone: OverviewTone | "off";
  doubt: boolean;
}

const lower = (word: string | null | undefined) => (word ?? "").toLowerCase();
const toneOf = (tone: string | null | undefined): OverviewTone =>
  tone === "error" ? "error" : tone === "attention" ? "attention" : "ok";

export function studioRows(input: {
  lighting: LightingSnapshot | null;
  audio: Pick<AudioWorkspaceViewModel, "consoleSnapshots" | "status" | "valuesInDoubt"> | null;
  prompter: PrompterSnapshot | null;
  cameras: CamerasSnapshot | null;
  picturesWord: string | null;
  surface: HeaderItem | null;
}): StudioRow[] {
  const rows: StudioRow[] = [];
  const { lighting, audio, prompter, cameras, surface } = input;

  if (lighting) {
    const live = liveSceneOf(lighting);
    const lit = lighting.fixtures.filter((fixture) => fixture.on).length;
    const unsaved = lighting.sceneState === "unsaved";
    rows.push({
      id: "lighting",
      label: "Lighting",
      value: `${live?.name ?? "No scene"} · ${lit} of ${lighting.fixtures.length} lit`,
      // The live scene's word on the rig, as the deck's RECALL says it.
      word: unsaved ? "unsaved" : lighting.sceneState === "live" ? "on rig" : "no scene",
      tone: unsaved ? "attention" : lighting.sceneState === "live" ? "ok" : "off",
      doubt: false,
    });
  }

  if (audio) {
    const active = audio.consoleSnapshots.find((entry) => entry.state === "active" || entry.state === "changed");
    rows.push({
      id: "console",
      label: "Console",
      value: active?.name ?? "nothing loaded",
      word: audio.valuesInDoubt
        ? lower(audio.status.label)
        : active?.state === "changed"
          ? "changed"
          : active
            ? "active"
            : "none",
      tone: audio.valuesInDoubt
        ? toneOf(audio.status.tone)
        : active?.state === "changed"
          ? "attention"
          : active
            ? "ok"
            : "off",
      doubt: audio.valuesInDoubt,
    });
  }

  if (prompter) {
    const { screen } = prompter;
    const size = screen.width !== null && screen.height !== null ? `${screen.width}×${screen.height}` : null;
    rows.push({
      id: "prompter",
      label: "Prompter XL",
      value: size ? (screen.refreshHz !== null ? `${size} · ${screen.refreshHz} Hz` : size) : "—",
      word: lower(screen.word),
      tone: toneOf(screen.tone),
      doubt: false,
    });
  }

  if (cameras) {
    const showing = cameras.pictures.state === "showing";
    rows.push({
      id: "pictures",
      label: "Pictures",
      value: input.picturesWord ?? "",
      word: showing ? "live" : lower(cameras.pictures.word) || "none",
      tone: showing ? "ok" : toneOf(cameras.pictures.tone),
      doubt: false,
    });
  }

  rows.push({
    id: "deck",
    label: "Deck",
    value: "Stream Deck+",
    word: surface?.detail ?? "not read",
    tone: surface ? toneOf(surface.status) : "off",
    doubt: false,
  });
  return rows;
}

// ---------------------------------------------------------------------------
// The sound: the inputs TotalMix shows (D45)
// ---------------------------------------------------------------------------

/** How many input strips THE SOUND has room for, on its one meter bridge. */
export const SOUND_STRIPS = 4;

/**
 * The inputs the Overview shows: the hardware inputs TotalMix shows (a strip
 * it hides, D45, is left out), in TotalMix's order, as many as the bridge
 * holds. The studio hides inputs 1 to 8, which leaves the four preamps.
 */
export function soundInputs<Channel extends { role: string; hidden?: boolean }>(
  channels: readonly Channel[]
): Channel[] {
  return channels.filter((channel) => channel.role !== "playback-pair" && !channel.hidden).slice(0, SOUND_STRIPS);
}

// ---------------------------------------------------------------------------
// The script: the place, the time left, the cues ahead
// ---------------------------------------------------------------------------

export interface CueAhead {
  paragraph: number;
  text: string;
  /** `0:10`, counted down as `Left` is; `—` before the glass is laid out. */
  time: string;
  /** The seconds left, `null` without a layout. */
  seconds: number | null;
}

/**
 * The next cues ahead of the reading line, each with the time until it at the
 * pace (the hardware link's `secondsAhead`, counted down by the seconds since
 * its report). Before a layout there is no time: the cues after the place.
 */
export function cuesAhead(glass: PrompterGlassSummary, elapsedSeconds: number, room = 3): CueAhead[] {
  const after = (cue: PrompterCue) =>
    cue.paragraph > glass.place.paragraph || (cue.paragraph === glass.place.paragraph && cue.word > glass.place.word);
  const ahead = glass.cues
    .map((cue) => ({ cue, seconds: cue.secondsAhead === null ? null : cue.secondsAhead - elapsedSeconds }))
    .filter(({ cue, seconds }) => (seconds === null ? after(cue) : seconds > -0.5));
  return ahead.slice(0, room).map(({ cue, seconds }) => ({
    paragraph: cue.paragraph,
    text: cue.text,
    seconds,
    time: seconds === null ? "—" : formatDuration(Math.max(0, seconds)),
  }));
}

/** The place in two parts, as the board's Place well prints it: `¶ 8 of 18` and `44 %`. */
export function placeParts(glass: PrompterGlassSummary, share: number): { paragraph: string; share: string } {
  if (glass.atEnd || glass.place.paragraph >= glass.paragraphCount) return { paragraph: "END", share: "100 %" };
  return {
    paragraph: `¶ ${glass.place.paragraph + 1} of ${glass.paragraphCount}`,
    share: `${Math.floor(share * 100)} %`,
  };
}

/**
 * The glass band (the board's note 9): the glass's own copy, cropped to its
 * text column with the arrow, and moved so that its reading line stands at
 * the glass's own share of the band's height. From the look, so the line
 * breaks stay the glass's: the copy is laid out at 1,920 px and scaled.
 */
export function glassBand(
  text: Pick<PrompterGlassText, "look" | "sizePx" | "paragraphs">,
  band: { width: number; height: number }
) {
  const metrics = glassMetrics(text.look, text.sizePx, text.paragraphs.length);
  // 10 px of the glass before the arrow, 30 after the column's right edge.
  const cropLeft = Math.max(0, metrics.arrowLeft - 10);
  const visible = Math.min(GLASS_WIDTH, GLASS_WIDTH - metrics.columnLeft + 30) - cropLeft;
  const scale = band.width / visible;
  const share = text.look.readingLinePercent / 100;
  return {
    scale,
    width: GLASS_WIDTH * scale,
    left: -cropLeft * scale,
    top: band.height * share - metrics.readingY * scale,
    /** Where the reading line stands in the band, from its top. */
    readingLine: band.height * share,
  };
}

// ---------------------------------------------------------------------------
// The footer: the day so far (the board's note 13)
// ---------------------------------------------------------------------------

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** `09:14` today, `22 Apr 09:14` another day. */
export function shortTime(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? clock.format(at) : `${day.format(at)} ${clock.format(at)}`;
}

/** `4 · 41 min`, `none yet`, or `not read` when the log could not be read. */
export function takesTodayWord(takes: CamerasSnapshot["takesToday"] | undefined): string {
  if (!takes) return "not read";
  if (takes.count === 0) return "none yet";
  return `${takes.count} · ${Math.round(takes.recordedSeconds / 60)} min`;
}

/** The Console's last sync: `09:14`, or `none since the start`. */
export function lastSyncWord(audio: Pick<AudioSnapshot, "lastConsoleSyncAt"> | null, now: Date): string {
  return shortTime(audio?.lastConsoleSyncAt ?? null, now) ?? "none since the start";
}
