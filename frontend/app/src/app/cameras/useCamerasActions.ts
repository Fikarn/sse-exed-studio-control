import { useEffect, useRef, useState } from "react";

import type { UseArmResult } from "@sse/design-system";
import {
  EngineRequestError,
  type CameraNumber,
  type CameraSnapshot,
  type JsonValue,
  type ShellStore,
} from "@sse/engine-client";

import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { cameraOf, camerasFingerprint } from "./camerasModel";
import { STOP_WINDOW_MS, type PerformAction } from "./perform";
import { STOP_ARM_KEY } from "./useCamerasArming";

// What a page that shows the cameras does with them (2026-10-09: lifted from
// the Cameras page for the Overview, D47, which shows CAM 1's take and the
// pictures too). Both pages run the same loop and press REC the same way.

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

/**
 * The page reads the cameras once a second while it is open: a camera says
 * nothing by itself until its link is built, and a read sends nothing (D12).
 * It also says once a second that it shows the pictures (D28): they come while
 * it says so and a while after. Answers the clock the take's length is
 * counted against, which ticks with the reads.
 */
export function useCamerasFollow(store: ShellStore): number {
  const [now, setNow] = useState(() => Date.now());
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
  return now;
}

/**
 * Runs a camera action: its sentence as a toast when asked, and a refusal in
 * the hardware link's words, after which the page reads the cameras again.
 */
export function useCamerasPerform(store: ShellStore): PerformAction {
  const toast = useToast();
  return useLiveCallback(async (action: () => Promise<JsonValue>, announce = false) => {
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
}

/**
 * One read of the cameras, which sends nothing and leaves no row. The page
 * says that it tried when nothing has changed; what has changed shows.
 * `camera` is the one a key names, `null` for all three.
 */
export function useCamerasReadAgain(store: ShellStore): (camera: CameraNumber | null) => Promise<void> {
  const toast = useToast();
  return useLiveCallback(async (camera: CameraNumber | null) => {
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
}

/**
 * REC: one press starts a take on CAM 1; while it records the first press
 * arms and a second within the window stops it (D11). Nothing while CAM 1 is
 * not held.
 */
export function useRecPress(
  store: ShellStore,
  main: CameraSnapshot | null,
  arm: UseArmResult,
  perform: PerformAction
): () => void {
  return useLiveCallback(() => {
    if (main?.state !== "held") return;
    if (main.recording.recording !== true) {
      void perform(() => store.startCameraRecording());
      return;
    }
    arm.armOrApply(
      STOP_ARM_KEY,
      "Stop recording on CAM 1",
      () => void perform(() => store.stopCameraRecording(true)),
      STOP_WINDOW_MS
    );
  });
}
