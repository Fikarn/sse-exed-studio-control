import { useLayoutEffect, useRef } from "react";

import type { CameraNumber } from "@sse/engine-client";

import { PICTURE, type Rect } from "./pictureGeometry";
import { pictureSource } from "./testPicture";

// One view of a camera's picture: a part of it, drawn on a canvas at the
// size it has on screen, with the aids laid over. A picture is signal, not
// chrome: it is marked `data-picture`, and the layout measures skip it.

export interface PictureAids {
  guides: boolean;
  zebras: boolean;
  peaking: boolean;
}

export const NO_AIDS: PictureAids = { guides: false, zebras: false, peaking: false };

export interface CameraPictureProps {
  camera: CameraNumber;
  /** The part of the picture shown, in the picture's own pixels. */
  part: Rect;
  /** The canvas's size on screen. */
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const { guides, zebras, peaking } = aids;
  // The parts as numbers: a part is a new object at every render, and the
  // picture is drawn again only when one of them moved.
  const { x: partX, y: partY, width: partWidth, height: partHeight } = part;
  const markerX = marker?.x ?? null;
  const markerY = marker?.y ?? null;
  const markerWidth = marker?.width ?? null;
  const markerHeight = marker?.height ?? null;

  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    const source = pictureSource(camera);
    if (!context || !source) return;
    context.save();
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = !pixels;
    context.imageSmoothingQuality = "high";
    const draw = (layer: CanvasImageSource) =>
      context.drawImage(layer, partX, partY, partWidth, partHeight, 0, 0, width, height);
    draw(source.picture);
    const zebraLayer = zebras ? source.zebras() : null;
    if (zebraLayer) draw(zebraLayer);
    const peakingLayer = peaking ? source.peaking() : null;
    if (peakingLayer) draw(peakingLayer);
    const marked =
      markerX !== null && markerY !== null && markerWidth !== null && markerHeight !== null
        ? { x: markerX, y: markerY, width: markerWidth, height: markerHeight }
        : null;
    if (guides || marked) {
      // The guides and the marker are drawn in the picture's own pixels.
      context.scale(width / partWidth, height / partHeight);
      context.translate(-partX, -partY);
      if (guides) drawGuides(context);
      if (marked) drawMarker(context, marked);
    }
    context.restore();
  }, [
    camera,
    partX,
    partY,
    partWidth,
    partHeight,
    width,
    height,
    guides,
    zebras,
    peaking,
    markerX,
    markerY,
    markerWidth,
    markerHeight,
    pixels,
  ]);

  return (
    <canvas
      ref={canvas}
      className={className}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      data-picture=""
      data-camera={camera}
      data-part={`${part.x},${part.y},${part.width},${part.height}`}
      data-aids={[guides ? "guides" : "", zebras ? "zebras" : "", peaking ? "peaking" : ""].filter(Boolean).join(" ")}
      data-testid={testId}
    />
  );
}
