import { useEffect, useLayoutEffect, useRef } from "react";

import type { CameraNumber } from "@sse/engine-client";

import { createPictureDrawer, type PictureDrawer } from "./pictureDrawer";
import type { PictureFrames } from "./pictureFrames";
import { PICTURE, type Rect } from "./pictureGeometry";
import styles from "./CameraPicture.module.css";

// One view of a camera's picture: a part of it, drawn with WebGL2 at the size it has on
// screen (`pictureDrawer.ts`), with the zebras and the peaking laid over by the shader,
// and the guides and the loupe's marker on a canvas above it. It draws each new frame of
// its camera as it comes, and again when what it shows changes. A picture is signal, not
// chrome: it is marked `data-picture`, and the layout measures skip it. `data-drawn`
// says which frame is on it, for the page tests.

export interface PictureAids {
  guides: boolean;
  zebras: boolean;
  peaking: boolean;
}

export const NO_AIDS: PictureAids = { guides: false, zebras: false, peaking: false };

export interface CameraPictureProps {
  camera: CameraNumber;
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
  context.strokeStyle = "rgba(255, 255, 255, 0.45)";
  context.lineWidth = 2;
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
  context.strokeStyle = "rgba(255, 255, 255, 0.7)";
  context.beginPath();
  context.moveTo(width / 2 - 30, height / 2);
  context.lineTo(width / 2 + 30, height / 2);
  context.moveTo(width / 2, height / 2 - 30);
  context.lineTo(width / 2, height / 2 + 30);
  context.stroke();
  context.restore();
}

function drawMarker(context: CanvasRenderingContext2D, marker: Rect) {
  context.save();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.setLineDash([14, 8]);
  context.strokeRect(marker.x, marker.y, marker.width, marker.height);
  context.restore();
}

export function CameraPicture({
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
      data-aids={[guides ? "guides" : "", zebras ? "zebras" : "", peaking ? "peaking" : ""].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      <canvas ref={picture} className={styles.picture} width={width} height={height} />
      <canvas ref={overlay} className={styles.overlay} width={width} height={height} />
    </div>
  );
}
