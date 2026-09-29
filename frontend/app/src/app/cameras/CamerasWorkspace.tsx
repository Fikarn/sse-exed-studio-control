import { useEffect, useMemo, useRef, useState } from "react";

import { ShellRegion, useArm } from "@sse/design-system";
import {
  EngineRequestError,
  type CameraDialBank,
  type CameraNumber,
  type CameraPressSetting,
  type CamerasSnapshot,
  type JsonValue,
  type PicturesLink,
  type ShellStore,
} from "@sse/engine-client";

import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { CamerasBay } from "./CamerasBay";
import { CamerasCluster } from "./CamerasCluster";
import { CamerasFooter } from "./CamerasFooter";
import { CamerasPlate } from "./CamerasPlate";
import {
  cameraNumber,
  cameraOf,
  camerasFingerprint,
  camerasStateView,
  releasedTo,
  selectedCamera,
} from "./camerasModel";
import { STOP_WINDOW_MS, type PerformAction } from "./perform";
import { NO_AIDS, type PictureAids } from "./pictures/CameraPicture";
import { usePictureFrames } from "./pictures/pictureFrames";
import { CENTRE, type BigView, type LoupeZoom, type Point } from "./pictures/pictureGeometry";
import styles from "./CamerasWorkspace.module.css";

// The Cameras page (board 2, "Hero and two", `docs/design/boards/A-cameras-2.html`,
// as D10, D11 and D19 amend it). The cluster holds the state, the take and
// the three cameras; the bay shows the selected camera big and the other two
// small; the plate sets the selected camera. There is one selection (D19): a
// camera's key and a small picture both select, and the big picture, the
// plate and the deck's dials follow.
//
// Everything the page shows is the hardware link's (`camerasModel.ts`). What
// it holds itself is what the operator is looking at, and all of it is off
// again at every start: the view, the picture aids, the loupe and the one
// armed key. One press sets exposure, colour and focus and starts a take;
// stopping it, the format, the look and Release are press twice (D11).
//
// The page reads the cameras once a second while it is open: a camera says
// nothing by itself until its link is built, and a read sends nothing (D12).
// It also says once a second that it shows the pictures, and takes the three
// cameras' newest frames from the shell while it is open, one take at a time
// (the camera pictures, D28): frames come while it says so and a while after.

export interface CamerasWorkspaceProps {
  camerasSnapshot: CamerasSnapshot | null;
  /** Where the page takes the pictures from; `null` in a window with none. */
  pictures?: PicturesLink | null;
  store: ShellStore;
}

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

const EVERY_CAMERA: Record<CameraNumber, Point> = { 1: CENTRE, 2: CENTRE, 3: CENTRE };

export function CamerasWorkspace({ camerasSnapshot, pictures = null, store }: CamerasWorkspaceProps) {
  const toast = useToast();
  const arm = useArm();
  const [view, setView] = useState<BigView>("whole");
  const [aids, setAids] = useState<PictureAids>(NO_AIDS);
  const [zoom, setZoom] = useState<LoupeZoom>(2);
  const [points, setPoints] = useState(EVERY_CAMERA);
  const [now, setNow] = useState(() => Date.now());

  const selected = camerasSnapshot ? selectedCamera(camerasSnapshot) : null;
  const selectedNumber = selected ? cameraNumber(selected) : 1;
  const main = camerasSnapshot ? cameraOf(camerasSnapshot, 1) : null;
  const state = useMemo(() => (camerasSnapshot ? camerasStateView(camerasSnapshot) : null), [camerasSnapshot]);

  const frames = usePictureFrames(pictures);

  // A read that fails is recorded when it begins to fail, not once a second.
  const readFailing = useRef(false);
  useEffect(() => {
    // The pictures are wanted from the moment the page opens: it says so now,
    // then with every read. What it says changes nothing, so a failure is not
    // worth a word.
    const showPictures = () => void store.showCameraPictures().catch(() => {});
    showPictures();
    const id = window.setInterval(() => {
      showPictures();
      setNow(Date.now());
      store.refreshCamerasSnapshot().then(
        () => {
          readFailing.current = false;
        },
        (error: unknown) => {
          if (!readFailing.current) store.reportBackgroundFailure(error, "the cameras");
          readFailing.current = true;
        }
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [store]);

  // An armed key names a camera that must still be held when it is pressed
  // again: a camera that was released, lost or selected away drops the arm.
  const armedKey = arm.armed?.key ?? null;
  const armedCamera = armedKey === null ? null : armedKey === "stop" ? 1 : Number(armedKey.split(":")[1]);
  const armedHeld =
    armedCamera === null || (camerasSnapshot && cameraOf(camerasSnapshot, armedCamera)?.state) === "held";
  const armedInView = armedKey === null || armedKey === "stop" || armedCamera === selectedNumber;
  const stillRecording = armedKey !== "stop" || main?.recording.recording === true;
  const clearArm = arm.clear;
  useEffect(() => {
    if (!armedHeld || !armedInView || !stillRecording) clearArm();
  }, [armedHeld, armedInView, stillRecording, clearArm]);

  const perform: PerformAction = useLiveCallback(async (action, announce = false) => {
    try {
      const result = await action();
      const sentence = announce ? sentenceOf(result) : null;
      if (sentence) toast.push({ tone: "ok", message: sentence });
      return result;
    } catch (error) {
      // A camera that is held already is no fault: the page says so and reads again.
      const alreadyHeld = error instanceof EngineRequestError && error.code === "CAMERA_ALREADY_HELD";
      toast.push({
        tone: alreadyHeld ? "info" : "attention",
        message:
          error instanceof Error
            ? error.message
            : "The cameras did not answer. Look at what the page shows before pressing again.",
      });
      store.refreshCamerasSnapshot().catch((failure: unknown) => store.reportBackgroundFailure(failure, "the cameras"));
      return null;
    }
  });

  /**
   * One read of the cameras, which sends nothing and leaves no row. The page
   * says that it tried when nothing has changed; what has changed shows.
   */
  const readAgain = useLiveCallback(async (camera: CameraNumber | null) => {
    const before = camerasFingerprint(store.getSnapshot().camerasSnapshot);
    try {
      await store.refreshCamerasSnapshot();
    } catch (error) {
      toast.push({
        tone: "attention",
        message: error instanceof Error ? error.message : "The cameras could not be read. Try again.",
      });
      return;
    }
    const after = store.getSnapshot().camerasSnapshot;
    if (camerasFingerprint(after) !== before) return;
    const asked = camera !== null && after ? cameraOf(after, camera) : null;
    toast.push({
      tone: "info",
      message: asked ? `Read again: nothing has changed. ${asked.sentence}` : "Read again: nothing has changed.",
    });
  });

  const select = useLiveCallback((camera: CameraNumber) => {
    if (camera === selectedNumber) return;
    void perform(() => store.selectCamera(camera));
  });
  // What the deck's dials set: the hardware link keeps it, as it keeps the selection.
  const bank = useLiveCallback((next: CameraDialBank) => {
    if (next === camerasSnapshot?.dials.bank) return;
    void perform(() => store.setCameraDialBank(next));
  });
  const step = useLiveCallback((setting: CameraPressSetting, steps: number) => {
    void perform(() => store.stepCameraValue({ camera: selectedNumber, setting, step: steps }));
  });
  const set = useLiveCallback((setting: CameraPressSetting, value: string | number) => {
    void perform(() => store.setCameraValue({ camera: selectedNumber, setting, value }));
  });
  const auto = useLiveCallback((what: "focus" | "whiteBalance" | "iris") => {
    void perform(() => store.runCameraAuto({ camera: selectedNumber, what }));
  });
  const connect = useLiveCallback((camera: CameraNumber) => {
    void perform(() => store.connectCamera(camera), true);
  });
  const openSetup = useLiveCallback(() => {
    void perform(() => store.openSetupSection("cameras"));
  });
  const openActions = useLiveCallback(() => {
    void perform(() => store.openSetupSection("support"));
  });

  const record = useLiveCallback(() => {
    if (main?.state !== "held") return;
    if (main.recording.recording !== true) {
      void perform(() => store.startCameraRecording());
      return;
    }
    arm.armOrApply(
      "stop",
      "Stop recording on CAM 1",
      () => void perform(() => store.stopCameraRecording(true)),
      STOP_WINDOW_MS
    );
  });
  const release = useLiveCallback(() => {
    if (!selected) return;
    const camera = selectedNumber;
    arm.armOrApply(
      `release:${camera}`,
      `Release ${selected.tag} to ${releasedTo(selected)}`,
      () => void perform(() => store.releaseCamera(camera, true), true)
    );
  });
  const format = useLiveCallback((setting: "resolution" | "frameRate", value: string) => {
    if (!selected) return;
    const camera = selectedNumber;
    const current = selected.values[setting].value;
    if (current === value) return;
    const unit = setting === "frameRate" ? "p" : "";
    const what = setting === "frameRate" ? "Frame rate" : "Resolution";
    arm.armOrApply(
      `format:${camera}:${setting}:${value}`,
      `${what} ${current ?? "—"}${unit} → ${value}${unit} on ${selected.tag}`,
      () => void perform(() => store.setCameraFormat({ camera, [setting]: value, confirm: true }), true)
    );
  });
  const look = useLiveCallback((setting: "dynamicRange" | "displayLut" | "displayLutOn", value: string | boolean) => {
    if (!selected) return;
    const camera = selectedNumber;
    if (selected.values[setting].value === value) return;
    const what =
      setting === "dynamicRange"
        ? `Dynamic range → ${String(value)}`
        : setting === "displayLut"
          ? `Display LUT → ${String(value)}`
          : `Display LUT ${value === true ? "on" : "off"}`;
    arm.armOrApply(
      `look:${camera}:${setting}:${String(value)}`,
      `${what} on ${selected.tag}`,
      () => void perform(() => store.setCameraLook({ camera, [setting]: value, confirm: true }), true)
    );
  });

  const moveLoupe = useLiveCallback((point: Point) => {
    setPoints((held) => ({ ...held, [selectedNumber]: point }));
  });
  const toggleAid = useLiveCallback((aid: keyof PictureAids) => {
    setAids((held) => ({ ...held, [aid]: !held[aid] }));
  });

  if (!camerasSnapshot || !selected || !state) {
    return (
      <div className={styles.waiting} data-testid="cameras-workspace" data-workspace="cameras">
        <p className={styles.waitingText}>Reading the cameras…</p>
      </div>
    );
  }

  return (
    <div className={styles.workspace} data-testid="cameras-workspace" data-workspace="cameras">
      <ShellRegion region="cluster">
        <CamerasCluster
          armed={arm.armed}
          now={now}
          snapshot={camerasSnapshot}
          state={state}
          onBank={bank}
          onConnect={connect}
          onOpenActions={openActions}
          onOpenSetup={openSetup}
          onReadAgain={(camera) => void readAgain(camera)}
          onRecord={record}
          onSelect={select}
        />
      </ShellRegion>
      <CamerasBay
        aids={aids}
        frames={frames}
        point={points[selectedNumber]}
        selected={selected}
        snapshot={camerasSnapshot}
        view={view}
        zoom={zoom}
        onMoveLoupe={moveLoupe}
        onSelect={select}
        onToggleAid={toggleAid}
        onView={setView}
        onZoom={setZoom}
      />
      <ShellRegion region="plate">
        <CamerasPlate
          armed={arm.armed}
          camera={selected}
          mainRecording={main?.state === "held" && main.recording.recording === true}
          onAuto={auto}
          onConnect={connect}
          onFormat={format}
          onLook={look}
          onOpenSetup={openSetup}
          onReadAgain={(camera) => void readAgain(camera)}
          onRelease={release}
          onSet={set}
          onStep={step}
        />
      </ShellRegion>
      <ShellRegion region="footer">
        <CamerasFooter
          now={now}
          selected={selected}
          snapshot={camerasSnapshot}
          stopArmed={arm.armed?.key === "stop"}
          view={view}
        />
      </ShellRegion>
    </div>
  );
}
