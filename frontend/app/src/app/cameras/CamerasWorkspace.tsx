import { useEffect, useMemo, useState } from "react";

import { ShellRegion } from "@sse/design-system";
import {
  type CameraDialBank,
  type CameraNumber,
  type CameraPressSetting,
  type CameraSnapshot,
  type CamerasSnapshot,
  type PicturePlaces,
  type PicturesLink,
  type ShellStore,
} from "@sse/engine-client";

import { useLiveCallback } from "../shared/useLiveCallback";
import { CamerasBay } from "./CamerasBay";
import { CamerasCluster } from "./CamerasCluster";
import { CamerasFooter } from "./CamerasFooter";
import { buildCameraMenu } from "./camerasMenus";
import { CamerasPlate } from "./CamerasPlate";
import { cameraNumber, cameraOf, camerasStateView, releaseLabel, selectedCamera } from "./camerasModel";
import { useCamerasFollow, useCamerasPerform, useCamerasReadAgain, useRecPress } from "./useCamerasActions";
import { armedCamera, camerasArmedWords, camerasArmKey, STOP_ARM_KEY, useCamerasArming } from "./useCamerasArming";
import { usePictureFrames } from "./pictures/pictureFrames";
import { type BigView, type Point } from "./pictures/pictureGeometry";
import { usePictureView } from "./pictures/pictureViewMemory";
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
// armed key. The aids, the loupe's zoom and its points it shares with the
// Overview (`usePictureView`, 2026-10-09, D47), which shows the same pictures. One press sets exposure, colour and focus and starts a take;
// stopping it, the format, the look and Release are press twice (D11).
//
// The visual overhaul (2026-10-05): one arm for the page (`useCamerasArming`),
// shared by REC's stop, the plate's Release, the format's and the look's
// choices and the selected camera's menu. Each camera has one menu, opened by
// its key's ⋯, its small picture's ⋯, the plate title's ⋯ or a right-click
// on any of them. Release from another camera's menu selects that camera and
// arms the plate's Release key once the hardware link says it is selected.
//
// The page reads the cameras once a second while it is open: a camera says
// nothing by itself until its link is built, and a read sends nothing (D12).
// It also says once a second that it shows the pictures (the camera pictures,
// D28): they come while it says so and a while after. In the app's window the
// pictures helper draws them over the page, and the bay says where each one
// stands (D30); in a browser the page takes the double's test cards and draws
// them itself.

export interface CamerasWorkspaceProps {
  camerasSnapshot: CamerasSnapshot | null;
  /** How the pictures reach the page; `null` in a window with none. */
  pictures?: PicturesLink | null;
  store: ShellStore;
}

export function CamerasWorkspace({ camerasSnapshot, pictures = null, store }: CamerasWorkspaceProps) {
  const arm = useCamerasArming();
  const [view, setView] = useState<BigView>("whole");
  const { view: pictureView, toggleAid, setZoom, setPoint } = usePictureView(store);
  const { aids, zoom, points } = pictureView;
  // The cameras read once a second, the pictures wanted (`useCamerasFollow`).
  const now = useCamerasFollow(store);

  const selected = camerasSnapshot ? selectedCamera(camerasSnapshot) : null;
  const selectedNumber = selected ? cameraNumber(selected) : 1;
  const main = camerasSnapshot ? cameraOf(camerasSnapshot, 1) : null;
  const state = useMemo(() => (camerasSnapshot ? camerasStateView(camerasSnapshot) : null), [camerasSnapshot]);

  const frames = usePictureFrames(pictures?.drawnBy === "page" ? pictures : null);
  const sayPlaces = useMemo(() => (pictures ? (places: PicturePlaces) => pictures.place(places) : null), [pictures]);

  // An armed key names a camera that must still be held when it is pressed
  // again: a camera that was released, lost or selected away drops the arm.
  // A menu's arm (`menu:release:N`) names its camera too.
  const armedKey = arm.armed?.key ?? null;
  const armedOn = armedKey === null ? null : armedCamera(armedKey);
  const armedHeld = armedOn === null || (camerasSnapshot && cameraOf(camerasSnapshot, armedOn)?.state) === "held";
  const armedInView = armedKey === null || armedKey === STOP_ARM_KEY || armedOn === null || armedOn === selectedNumber;
  const stillRecording = armedKey !== STOP_ARM_KEY || main?.recording.recording === true;
  const clearArm = arm.clear;
  useEffect(() => {
    if (!armedHeld || !armedInView || !stillRecording) clearArm();
  }, [armedHeld, armedInView, stillRecording, clearArm]);

  const perform = useCamerasPerform(store);
  const readAgain = useCamerasReadAgain(store);

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

  const record = useRecPress(store, main, arm, perform);
  /** The plate's Release key for `target`: the first press arms, the second releases. */
  const armRelease = (target: CameraSnapshot) => {
    const camera = cameraNumber(target);
    arm.armOrApply(
      camerasArmKey.release(camera),
      releaseLabel(target),
      () => void perform(() => store.releaseCamera(camera, true), true)
    );
  };
  const release = useLiveCallback(() => {
    if (selected) armRelease(selected);
  });
  // Release from the menu of a camera that is not selected: select it, then
  // arm the plate's Release key, and only if the read that follows the
  // selection says that camera is selected and held. That read is the one
  // chance: nothing waits for a later read, so a later selection of the camera,
  // by hand or from the deck, never arms anything. It never arms the camera
  // that was selected before, and it only arms (`armOnly`): it never gives the
  // second press, however late the selection's answer lands. (Until the
  // Teleprompter's review it checked the arm as it stood before the await,
  // and two hand-offs in quick succession could have been the two presses.)
  const releaseElsewhere = useLiveCallback(async (camera: CameraNumber) => {
    if (camera === selectedNumber) return;
    const answer = await perform(() => store.selectCamera(camera));
    if (answer === null) return;
    const now = store.getSnapshot().camerasSnapshot;
    const target = now?.selected === camera ? cameraOf(now, camera) : null;
    if (target?.state !== "held") return;
    arm.armOnly(camerasArmKey.release(camera), releaseLabel(target));
  });
  const format = useLiveCallback((setting: "resolution" | "frameRate", value: string) => {
    if (!selected) return;
    const camera = selectedNumber;
    const current = selected.values[setting].value;
    if (current === value) return;
    const unit = setting === "frameRate" ? "p" : "";
    const what = setting === "frameRate" ? "Frame rate" : "Resolution";
    arm.armOrApply(
      camerasArmKey.format(camera, setting, value),
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
      camerasArmKey.look(camera, setting, value),
      `${what} on ${selected.tag}`,
      () => void perform(() => store.setCameraLook({ camera, [setting]: value, confirm: true }), true)
    );
  });

  /** A camera's one menu, for its key, its small picture and the plate's title. */
  const cameraMenu = (camera: CameraSnapshot, testIdPrefix: string) => {
    const number = cameraNumber(camera);
    return buildCameraMenu({
      camera,
      selected: number === selectedNumber,
      testIdPrefix,
      onSelect: () => select(number),
      onConnect: () => connect(number),
      onReadAgain: () => void readAgain(number),
      onOpenSetup: openSetup,
      onRelease: () => void perform(() => store.releaseCamera(number, true), true),
      onReleaseElsewhere: () => void releaseElsewhere(number),
    });
  };
  const armedWords = arm.armed ? camerasArmedWords(arm.armed, camerasSnapshot) : null;

  const moveLoupe = useLiveCallback((point: Point) => {
    setPoint(selectedNumber, point);
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
          armedWords={armedWords}
          arm={arm}
          cameraMenu={cameraMenu}
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
        drawnBy={pictures?.drawnBy ?? "page"}
        frames={frames}
        point={points[selectedNumber]}
        selected={selected}
        snapshot={camerasSnapshot}
        view={view}
        zoom={zoom}
        onMoveLoupe={moveLoupe}
        onPlaces={sayPlaces}
        onSelect={select}
        arm={arm}
        cameraMenu={cameraMenu}
        onToggleAid={toggleAid}
        onView={setView}
        onZoom={setZoom}
      />
      <ShellRegion region="plate">
        <CamerasPlate
          armed={arm.armed}
          arm={arm}
          menu={cameraMenu(selected, "cameras-plate-menu")}
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
          stopArmed={arm.armed?.key === STOP_ARM_KEY}
          view={view}
        />
      </ShellRegion>
    </div>
  );
}
