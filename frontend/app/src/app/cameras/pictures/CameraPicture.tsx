import { useEffect, useLayoutEffect, useRef } from "react";

import type { CameraNumber } from "@sse/engine-client";

import { CROSS_ALPHA, CROSS_ARM, GUIDE_ALPHA, GUIDE_WIDTH, MARKER_DASH, MARKER_WIDTH } from "./pictureAids";
import { createPictureDrawer, type PictureDrawer } from "./pictureDrawer";
import type { PictureFrames } from "./pictureFrames";
import { PICTURE, type Rect } from "./pictureGeometry";
import styles from "./CameraPicture.module.css";

// One view of a camera's picture: a part of it, at the size it has on screen. A picture
// is signal, not chrome: it is marked `data-picture`, and the layout measures skip it.
//
// In the app's window the page draws nothing here (the camera pictures, D30): the
// pictures helper draws the picture, its aids and the loupe's marker over this place,
// which the page reports with the others (`picturePlaces.ts` reads `data-camera`,
// `data-part`, `data-pixels`, `data-aids` and `data-marker`).
//
// In a browser the page draws it with WebGL2 (`pictureDrawer.ts`), with the zebras and
// the peaking laid over by the shader, and the guides and the loupe's marker on a canvas
// above it. It draws each new frame of its camera as it comes, and again when what it
// shows changes. `data-drawn` says which frame is on it, for the page tests.

export interface PictureAids {
  guides: boolean;
  zebras: boolean;
  peaking: boolean;
}

export const NO_AIDS: PictureAids = { guides: false, zebras: false, peaking: false };

export interface CameraPictureProps {
  camera: CameraNumber;
  /** Who draws the picture: the page itself (a browser), or the pictures helper over the page (the app's window). */
  drawnBy?: "page" | "helper";
  frames: PictureFrames;
  /** The part of the picture shown, in the picture's own pixels. */
  part: Rect;
  /** The view's size on screen. */
  width: number;
  height: number;
  aids?: PictureAids;
  /** Where the loupe looks, as a part of the picture; drawn as a dashed frame. */
  marker?: Rect | null;
  /** Each of the picture's pixels as it is, without smoothing (the loupe). */
  pixels?: boolean;
  label: string;
  className?: string;
  testId?: string;
}

/** The guides: the thirds and a cross at the centre, in the picture's own pixels. */
function drawGuides(context: CanvasRenderingContext2D) {
  const { width, height } = PICTURE;
  context.save();
  context.strokeStyle = `rgba(255, 255, 255, ${GUIDE_ALPHA})`;
  context.lineWidth = GUIDE_WIDTH;
  context.beginPath();
  for (const x of [width / 3, (width * 2) / 3]) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (const y of [height / 3, (height * 2) / 3]) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
  context.strokeStyle = `rgba(255, 255, 255, ${CROSS_ALPHA})`;
  context.beginPath();
  context.moveTo(width / 2 - CROSS_ARM, height / 2);
  context.lineTo(width / 2 + CROSS_ARM, height / 2);
  context.moveTo(width / 2, height / 2 - CROSS_ARM);
  context.lineTo(width / 2, height / 2 + CROSS_ARM);
  context.stroke();
  context.restore();
}

function drawMarker(context: CanvasRenderingContext2D, marker: Rect) {
  context.save();
  context.strokeStyle = "#ffffff";
  context.lineWidth = MARKER_WIDTH;
  context.setLineDash([...MARKER_DASH]);
  context.strokeRect(marker.x, marker.y, marker.width, marker.height);
  context.restore();
}

export function CameraPicture(props: CameraPictureProps) {
  return props.drawnBy === "helper" ? <PicturePlace {...props} /> : <DrawnPicture {...props} />;
}

/** The aids as `data-aids` says them: `guides zebras peaking`, those that are on. */
const aidWords = ({ guides, zebras, peaking }: PictureAids) =>
  [guides ? "guides" : "", zebras ? "zebras" : "", peaking ? "peaking" : ""].filter(Boolean).join(" ");

/** The marker as `data-marker` says it, `x,y,width,height` in the picture's pixels; none without one. */
const markerWords = (marker: Rect | null) =>
  marker ? `${marker.x},${marker.y},${marker.width},${marker.height}` : undefined;

/** A picture's place in the app's window: empty in the page, with the helper's picture over it. */
function PicturePlace({
  camera,
  part,
  width,
  height,
  aids = NO_AIDS,
  marker = null,
  pixels = false,
  label,
  className,
  testId,
}: CameraPictureProps) {
  return (
    <div
      className={[styles.view, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      role="img"
      aria-label={label}
      data-picture=""
      data-camera={camera}
      data-part={`${part.x},${part.y},${part.width},${part.height}`}
      data-pixels={pixels ? "" : undefined}
      data-aids={aidWords(aids)}
      data-marker={markerWords(marker)}
      data-drawn="helper"
      data-testid={testId}
    />
  );
}

function DrawnPicture({
  camera,
  frames,
  part,
  width,
  height,
  aids = NO_AIDS,
  marker = null,
  pixels = false,
  label,
  className,
  testId,
}: CameraPictureProps) {
  const view = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const drawer = useRef<PictureDrawer | null>(null);
  const { guides, zebras, peaking } = aids;
  // The parts as numbers: a part is a new object at every render, and the picture is
  // drawn again only when one of them moved.
  const { x: partX, y: partY, width: partWidth, height: partHeight } = part;
  const markerX = marker?.x ?? null;
  const markerY = marker?.y ?? null;
  const markerWidth = marker?.width ?? null;
  const markerHeight = marker?.height ?? null;

  // What the next frame is drawn with: the latest of the view's own settings.
  const settings = useRef({ camera, part, smooth: !pixels, zebras, peaking });
  settings.current = {
    camera,
    part: { x: partX, y: partY, width: partWidth, height: partHeight },
    smooth: !pixels,
    zebras,
    peaking,
  };

  const drawNewest = useRef(() => {});
  drawNewest.current = () => {
    const now = settings.current;
    const frame = frames.latest(now.camera);
    if (!frame || !drawer.current) return;
    drawer.current.draw(frame, { part: now.part, smooth: now.smooth, zebras: now.zebras, peaking: now.peaking });
    view.current?.setAttribute("data-drawn", String(frame.sequence));
  };

  useLayoutEffect(() => {
    if (!picture.current) return undefined;
    drawer.current = createPictureDrawer(picture.current);
    view.current?.setAttribute("data-drawn", drawer.current ? "" : "no-webgl2");
    return () => {
      drawer.current?.dispose();
      drawer.current = null;
    };
  }, []);

  // Each new frame of the camera, as it comes.
  useEffect(() => frames.subscribe(camera, () => drawNewest.current()), [frames, camera]);

  // What the view shows changed: the newest frame again.
  useLayoutEffect(() => {
    drawNewest.current();
  }, [camera, partX, partY, partWidth, partHeight, zebras, peaking, pixels, width, height]);

  // The guides and the marker, in the picture's own pixels.
  useLayoutEffect(() => {
    const context = overlay.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const marked =
      markerX !== null && markerY !== null && markerWidth !== null && markerHeight !== null
        ? { x: markerX, y: markerY, width: markerWidth, height: markerHeight }
        : null;
    if (!guides && !marked) return;
    context.save();
    context.scale(width / partWidth, height / partHeight);
    context.translate(-partX, -partY);
    if (guides) drawGuides(context);
    if (marked) drawMarker(context, marked);
    context.restore();
  }, [guides, markerX, markerY, markerWidth, markerHeight, partX, partY, partWidth, partHeight, width, height]);

  return (
    <div
      ref={view}
      className={[styles.view, className].filter(Boolean).join(" ")}
      style={{ width, height }}
      role="img"
      aria-label={label}
      data-picture=""
      data-camera={camera}
      data-part={`${part.x},${part.y},${part.width},${part.height}`}
      data-pixels={pixels ? "" : undefined}
      data-aids={aidWords(aids)}
      data-marker={markerWords(marker)}
      data-testid={testId}
    >
      <canvas ref={picture} className={styles.picture} width={width} height={height} />
      <canvas ref={overlay} className={styles.overlay} width={width} height={height} />
    </div>
  );
}
