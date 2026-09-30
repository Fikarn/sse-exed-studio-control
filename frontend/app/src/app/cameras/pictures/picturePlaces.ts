import { useEffect, type RefObject } from "react";

import type { PictureCamera, PicturePlaces, PlaceRect, PlacedPicture } from "@sse/engine-client";

// Where the Cameras page's pictures stand (the camera pictures, D30). In the app's window
// the pictures helper draws the pictures itself, in a layer over the page, and the page
// is the one authority for what is where: it measures its own layout and says the bay's
// box, each picture's box and part, and what it draws over a picture (a small picture's
// chip, a message, a hint), which the helper leaves clear. While anything stands over
// the bay that the helper cannot leave a hole for (a dialog, the values list), or the
// window is hidden, the page says it shows no picture, and the layer hides.
//
// It says so at every change and once a second: the shell hides the layer when the page
// has been silent for a while, since a page that is reloaded says no goodbye.

/** The most pictures a report holds: the big one, the two small ones, the loupe. */
export const MAX_PICTURES = 4;
/** The most holes a report holds. */
export const MAX_HOLES = 8;
/** How often the page says its places again when nothing moved. */
const SAY_AGAIN_MS = 1000;

/** What stands over a picture's place and is left clear by the helper. A hint is in the page all the time, and counts while it is shown. */
const FLOATING =
  '[data-picture-hole], [data-level="float"], [role="tooltip"][data-visible], [role="menu"], [role="listbox"]';
/** What stands over the bay and hides every picture while it is there. */
const COVERING = '[role="dialog"]';

/** A picture as the page laid it out. */
export interface MeasuredPicture {
  camera: PictureCamera;
  box: PlaceRect;
  part: PlaceRect;
  smooth: boolean;
}

/** The page's layout, as measured. */
export interface MeasuredPlaces {
  /** Physical pixels a CSS pixel. */
  scale: number;
  /** The window is visible. */
  visible: boolean;
  /** Something stands over the bay that hides the pictures. */
  covered: boolean;
  bay: PlaceRect;
  pictures: MeasuredPicture[];
  /** Everything that floats over the page, wherever it is. */
  floating: PlaceRect[];
}

const overlaps = (one: PlaceRect, other: PlaceRect) =>
  one.width > 0 &&
  one.height > 0 &&
  other.width > 0 &&
  other.height > 0 &&
  one.x < other.x + other.width &&
  other.x < one.x + one.width &&
  one.y < other.y + other.height &&
  other.y < one.y + one.height;

const whole = ({ x, y, width, height }: PlaceRect): PlaceRect => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
});

/** The report for a layout: what the helper draws, or that the page shows no picture. */
export function buildPlaces(measured: MeasuredPlaces): PicturePlaces {
  const pictures: PlacedPicture[] = measured.pictures
    .filter((picture) => picture.box.width > 0 && picture.box.height > 0)
    .slice(0, MAX_PICTURES)
    .map((picture) => ({ camera: picture.camera, at: picture.box, part: whole(picture.part), smooth: picture.smooth }));
  const showing = measured.visible && !measured.covered && pictures.length > 0;
  if (!showing) return { showing: false, scale: measured.scale, bay: measured.bay, pictures: [], holes: [] };
  // Only what stands over a picture: the layer is clear everywhere else already.
  const holes = measured.floating
    .filter((box) => pictures.some((picture) => overlaps(box, picture.at)))
    .slice(0, MAX_HOLES);
  return { showing: true, scale: measured.scale, bay: measured.bay, pictures, holes };
}

const boxOf = (element: Element): PlaceRect => {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { x: left, y: top, width, height };
};

function partOf(text: string | undefined): PlaceRect | null {
  const numbers = (text ?? "").split(",").map(Number);
  if (numbers.length !== 4 || numbers.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = numbers as [number, number, number, number];
  return { x, y, width, height };
}

const isCamera = (value: number): value is PictureCamera => value === 1 || value === 2 || value === 3;

/** The bay's layout as it stands now: its pictures (`data-picture`) and what floats over the page. */
export function measurePlaces(bay: HTMLElement): MeasuredPlaces {
  const pictures: MeasuredPicture[] = [];
  for (const element of bay.querySelectorAll<HTMLElement>("[data-picture]")) {
    const camera = Number(element.dataset.camera);
    const part = partOf(element.dataset.part);
    if (!isCamera(camera) || !part) continue;
    pictures.push({ camera, box: boxOf(element), part, smooth: element.dataset.pixels === undefined });
  }
  return {
    scale: window.devicePixelRatio,
    visible: document.visibilityState === "visible",
    covered: document.querySelector(COVERING) !== null,
    bay: boxOf(bay),
    pictures,
    floating: Array.from(document.querySelectorAll(FLOATING), boxOf),
  };
}

/**
 * Says the bay's places to `place` for as long as the calling page is mounted: at every
 * change of the page, and once a second. When the page goes, it says that it shows no
 * picture. Nothing is said without `place` (a window with no pictures).
 */
export function usePicturePlaces(bay: RefObject<HTMLElement | null>, place: ((places: PicturePlaces) => void) | null) {
  useEffect(() => {
    const element = bay.current;
    if (!place || !element) return undefined;
    let said = "";
    const say = (again: boolean) => {
      const places = buildPlaces(measurePlaces(element));
      const line = JSON.stringify(places);
      if (!again && line === said) return;
      said = line;
      place(places);
    };
    const changed = () => say(false);
    // A dialog, a message or a hint comes and goes as nodes; a picture's part and camera
    // are attributes of its place.
    const mutations = new MutationObserver(changed);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-part", "data-camera", "data-pixels", "data-visible"],
    });
    const sizes = new ResizeObserver(changed);
    sizes.observe(element);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("resize", changed);
    const again = window.setInterval(() => say(true), SAY_AGAIN_MS);
    say(true);
    return () => {
      mutations.disconnect();
      sizes.disconnect();
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("resize", changed);
      window.clearInterval(again);
      place({ showing: false, scale: window.devicePixelRatio, bay: boxOf(element), pictures: [], holes: [] });
    };
  }, [bay, place]);
}
