import type { PictureFrame } from "./pictureFrame";

// How the cameras' pictures reach the Cameras page (the camera pictures, D28 and D30).
//
// In the app's window the page draws no picture: the pictures helper draws them itself,
// into a layer the shell puts over the page, and the page only says where each picture
// stands (`place`). What it says is the page's own layout and nothing else: the bay's
// box, each picture's box and the part of the picture it shows, and what the page draws
// over a picture. The page holds no secret and never learns where the pictures come from.
//
// In a browser there is no such layer: the page takes the double's test cards (`next`)
// and draws them itself, as the page tests see them, and says the same places, which the
// double keeps for the tests.

export type PictureCamera = 1 | 2 | 3;

/** A box: on the page in CSS pixels, or a part of a picture in the picture's own pixels. */
export interface PlaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One picture as the page shows it. */
export interface PlacedPicture {
  camera: PictureCamera;
  /** Where it stands in the window. */
  at: PlaceRect;
  /** The part of the camera's 1920 × 1080 picture it shows, in whole pixels. */
  part: PlaceRect;
  /** Smoothed when scaled; the loupe shows each pixel as it is. */
  smooth: boolean;
}

/** What the page reports, at every change and once a second (the shell's `PlaceReport`). */
export interface PicturePlaces {
  /** The page shows the pictures now: the window visible, no dialog over them. */
  showing: boolean;
  /** Physical pixels a CSS pixel. */
  scale: number;
  /** The Cameras bay's box: nothing is drawn outside it. */
  bay: PlaceRect;
  pictures: PlacedPicture[];
  /** What the page draws over a picture's place: left clear for it. */
  holes: PlaceRect[];
}

/** The takes of a page that draws the pictures itself. */
export interface PictureTakes {
  /**
   * The cameras' newest frames since the last take, each once, in camera order; none when
   * none came. The page chooses neither the cameras nor the wait.
   */
  next(): Promise<PictureFrame[]>;
}

export interface PicturePlacesSink {
  /** Where the page's pictures stand now. Nothing is answered. */
  place(places: PicturePlaces): void;
}

export type PicturesLink =
  | ({ /** The page draws the frames it takes. */ drawnBy: "page" } & PictureTakes & PicturePlacesSink)
  | ({ /** The pictures helper draws them over the page. */ drawnBy: "helper" } & PicturePlacesSink);
