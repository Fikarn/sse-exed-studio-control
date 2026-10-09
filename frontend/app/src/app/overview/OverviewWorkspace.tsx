import { useEffect, useMemo, useState } from "react";

import { ShellRegion } from "@sse/design-system";
import type {
  AudioSnapshot,
  CamerasSnapshot,
  JsonObject,
  JsonValue,
  LightingSnapshot,
  PicturePlaces,
  PicturesLink,
  PrompterGlassSnapshot,
  PrompterSnapshot,
  ShellStore,
  WorkspaceId,
} from "@sse/engine-client";

import { audioLatches } from "../audio/audioLatches";
import { buildAudioViewModel, type AudioChannelGroupSelections } from "../audio/audioViewModel";
import { AudioMeterCanvasOverlay } from "../audio/components/AudioMeterCanvasOverlay";
import { cameraOf, picturesWord } from "../cameras/camerasModel";
import { usePictureFrames } from "../cameras/pictures/pictureFrames";
import { usePictureView } from "../cameras/pictures/pictureViewMemory";
import { useCamerasFollow, useCamerasPerform, useCamerasReadAgain, useRecPress } from "../cameras/useCamerasActions";
import { camerasArmedWords, STOP_ARM_KEY, useCamerasArming } from "../cameras/useCamerasArming";
import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { getSupportBackups, formatShortTimestamp, type HeaderItem } from "../shellData";
import type { PrompterGlassLayoutReport } from "../teleprompter/glass/PrompterGlass";
import { usePrompterElapsed, usePrompterTimeLeft } from "../teleprompter/prompterTime";
import { backParagraph, cutGlassText, glassTextOf, type ReportedLines } from "../teleprompter/teleprompterModel";
import { usePrompterFollow } from "../teleprompter/usePrompterFollow";
import { OverviewCluster } from "./OverviewCluster";
import { OverviewFooter } from "./OverviewFooter";
import { overviewLatches, overviewState, studioLinks, studioRows } from "./overviewModel";
import { OverviewPicture } from "./OverviewPicture";
import { OverviewScript } from "./OverviewScript";
import { OverviewSound } from "./OverviewSound";
import { useSpeedTape } from "./useSpeedTape";
import styles from "./OverviewWorkspace.module.css";

// The Overview (D47, board 3: `docs/design/boards/overview-3.html`, with
// `docs/design/overview-3.md` and `overview-2.md`): the landing page, every
// page's key facts at once, in four rooms with four jobs: THE TAKE (act),
// THE PICTURE (watch), THE SCRIPT (read) and THE SOUND (listen). During a
// take the operator turns the deck's SPEED dial and watches the picture, the
// script and the levels here, all at once.
//
// Everything the page shows is read from the snapshots the pages read and
// from the header's own lamps, and it sends only what the pages send: REC
// as the Cameras page sends it, the prompter's take keys as the Teleprompter
// page does, the mutes, the Sync and the clears as the Console does. It
// follows what the pages follow: the cameras and the pictures once a second
// (`useCamerasFollow`), the prompter's place while it scrolls
// (`usePrompterFollow`), the meters on the Console's own canvas. The state
// display mirrors the worst page and adds no words of its own; the room of
// the page it names takes its keyline.

export interface OverviewWorkspaceProps {
  appSnapshot: JsonObject | null;
  audioSnapshot: AudioSnapshot | null;
  camerasSnapshot: CamerasSnapshot | null;
  healthSnapshot: JsonObject | null;
  /** The header's lamps, chips and latches before the header leaves any out
   *  (`buildMonitorItems`): the Overview ranks them for the worst page. */
  lamps: readonly HeaderItem[];
  lightingSnapshot: LightingSnapshot | null;
  /** How the pictures reach the page; `null` in a window with none. */
  pictures?: PicturesLink | null;
  prompterGlassSnapshot: PrompterGlassSnapshot | null;
  prompterSnapshot: PrompterSnapshot | null;
  store: ShellStore;
  supportSnapshot: JsonObject | null;
}

const NO_CHIPS: AudioChannelGroupSelections = { "hardware-inputs": [], "software-playback": [] };

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

export function OverviewWorkspace({
  appSnapshot,
  audioSnapshot,
  camerasSnapshot,
  healthSnapshot,
  lamps,
  lightingSnapshot,
  pictures = null,
  prompterGlassSnapshot,
  prompterSnapshot,
  store,
  supportSnapshot,
}: OverviewWorkspaceProps) {
  const toast = useToast();

  // The cameras and the pictures, as the Cameras page follows them.
  const now = useCamerasFollow(store);
  const arm = useCamerasArming();
  const performCameras = useCamerasPerform(store);
  const readAgain = useCamerasReadAgain(store);
  const main = camerasSnapshot ? cameraOf(camerasSnapshot, 1) : null;
  const record = useRecPress(store, main, arm, performCameras);
  const recording = main?.state === "held" && main.recording.recording === true;
  // The stop arm names CAM 1, which must still be held and recording when it is pressed again.
  const clearArm = arm.clear;
  const stopArmed = arm.armed?.key === STOP_ARM_KEY;
  useEffect(() => {
    if (stopArmed && !recording) clearArm();
  }, [stopArmed, recording, clearArm]);
  const pictureView = usePictureView(store);
  const frames = usePictureFrames(pictures?.drawnBy === "page" ? pictures : null);
  const sayPlaces = useMemo(() => (pictures ? (places: PicturePlaces) => pictures.place(places) : null), [pictures]);

  // The prompter, as the Teleprompter page follows it.
  usePrompterFollow(store, prompterSnapshot);
  const glass = prompterSnapshot?.glass ?? null;
  const glassText = useMemo(
    () => glassTextOf(prompterSnapshot, prompterGlassSnapshot),
    [prompterSnapshot, prompterGlassSnapshot]
  );
  const cut = useMemo(() => cutGlassText(prompterGlassSnapshot), [prompterGlassSnapshot]);
  const timeLeft = usePrompterTimeLeft(glass);
  const elapsed = usePrompterElapsed(glass);
  // The tape's take goes on while CAM 1 does not answer for a moment: its
  // last known take (`RecKey`'s last-known form) is still the take.
  const tape = useSpeedTape(glass, {
    recording: main?.recording.recording === true && (main.state === "held" || main.state === "unreachable"),
    startedAt: main?.recording.startedAt ?? null,
  });
  // The layout the band last reported, which BACK's hint reads; the hardware
  // link keeps the first report for a key, so the band's is harmless beside
  // the Prompter XL's and the Teleprompter page's.
  const [reported, setReported] = useState<ReportedLines | null>(null);
  const reportLayout = useLiveCallback((report: PrompterGlassLayoutReport) => {
    setReported(report);
    store.reportPrompterLayout(report).catch((error: unknown) => {
      store.reportBackgroundFailure(error, "the Overview's copy of the glass");
    });
  });
  const backTo = glass ? backParagraph(glass, reported) : 0;

  // The sound, as the Console reads it.
  const audio = useMemo(
    () =>
      audioSnapshot
        ? buildAudioViewModel({ activeChannelGroups: NO_CHIPS, appSnapshot, audioSnapshot, bankIndex: 0 })
        : null,
    [appSnapshot, audioSnapshot]
  );
  const gated = audio?.meterSimulationState === "gated";

  /** Sends one request; a refusal is the hardware link's sentence, as a notice. */
  const perform = useLiveCallback(async (action: () => Promise<JsonValue>, announce = false) => {
    try {
      const result = await action();
      const sentence = announce ? sentenceOf(result) : null;
      if (sentence) toast.push({ tone: "ok", message: sentence });
      return result;
    } catch (error) {
      toast.push({
        tone: "attention",
        message:
          error instanceof Error
            ? error.message
            : "The hardware link did not answer. Look at the page before pressing again.",
      });
      return null;
    }
  });
  const open = useLiveCallback((page: WorkspaceId) => void perform(() => store.setWorkspace(page)));
  const sync = useLiveCallback(() => void perform(() => store.syncAudio(), true));
  const clearClips = useLiveCallback(() => void perform(() => store.clearAudioClips({})));

  const state = overviewState(
    {
      lamps,
      audio,
      cameras: camerasSnapshot,
      health: healthSnapshot,
      lighting: lightingSnapshot,
      prompter: prompterSnapshot,
    },
    studioLinks(lamps, camerasSnapshot)
  );
  // The room of the page the display names takes its keyline (the board's note 2).
  const alert = state.tone === "ok" ? null : state.tone;
  const latches = audio
    ? overviewLatches(audioLatches(audio), lightingSnapshot)
    : overviewLatches([], lightingSnapshot);
  const rows = studioRows({
    lighting: lightingSnapshot,
    audio,
    prompter: prompterSnapshot,
    cameras: camerasSnapshot,
    picturesWord: camerasSnapshot ? picturesWord(camerasSnapshot) : null,
    surface: lamps.find((item) => item.id === "surface") ?? null,
  });
  const latestBackup = getSupportBackups(supportSnapshot)[0] ?? null;

  return (
    <div
      className={styles.workspace}
      // The Console's metering gate, which its canvas reads from the page that mounts it.
      data-canvas-metering={gated ? "false" : "true"}
      data-meter-simulation-state={audio?.meterSimulationState ?? "gated"}
      data-testid="overview-workspace"
      data-workspace="overview"
    >
      <ShellRegion region="cluster">
        <OverviewCluster
          arm={arm}
          armedWords={arm.armed ? camerasArmedWords(arm.armed, camerasSnapshot) : null}
          audio={audio}
          glass={glass}
          backTo={backTo}
          latches={latches}
          main={main}
          now={now}
          prompterSnapshot={prompterSnapshot}
          rows={rows}
          state={state}
          stopArmed={stopArmed}
          onClearAudioSolo={() => void perform(() => store.clearAllAudioSolo())}
          onClearClips={clearClips}
          onClearLightingOverlay={() => void perform(() => store.highlightLightingFixtures([], "off"))}
          onOpen={open}
          onReadAgain={() => void readAgain(null)}
          onRecord={record}
          onSpeed={(step) => {
            tape.ownChange();
            void perform(() => store.setPrompterSpeed({ step }));
          }}
          onSync={sync}
          onTake={(action) => void perform(action)}
          store={store}
        />
      </ShellRegion>

      <div className={styles.bay} data-testid="overview-bay">
        <OverviewPicture
          alert={state.room === "picture" ? alert : null}
          drawnBy={pictures?.drawnBy ?? "page"}
          frames={frames}
          snapshot={camerasSnapshot}
          view={pictureView}
          onOpen={() => open("cameras")}
          onPlaces={sayPlaces}
        />
        <OverviewScript
          alert={state.room === "script" ? alert : null}
          cut={cut}
          elapsed={elapsed}
          glassText={glassText}
          now={now}
          snapshot={prompterSnapshot}
          tape={tape.view}
          timeLeft={timeLeft}
          onLayout={reportLayout}
          onOpen={() => open("teleprompter")}
        />
      </div>

      <ShellRegion region="plate">
        <OverviewSound
          alert={state.room === "sound" ? alert : null}
          audio={audio}
          onMute={(channelId, mute) => void perform(() => store.updateAudioChannel({ channelId, mute }))}
          onMuteOutput={(mixTargetId, mute) => void perform(() => store.updateAudioMixTarget({ mixTargetId, mute }))}
          onOpen={() => open("audio")}
        />
      </ShellRegion>

      <ShellRegion region="footer">
        <OverviewFooter
          audio={audioSnapshot}
          backup={latestBackup ? formatShortTimestamp(latestBackup.modifiedAt) : null}
          now={now}
          takesToday={camerasSnapshot?.takesToday}
        />
      </ShellRegion>

      {/* The Console's canvas paints the meters THE SOUND lays out, as on the Console. */}
      <AudioMeterCanvasOverlay peakHoldEnabled peakHoldResetToken={0} store={store} />
    </div>
  );
}
