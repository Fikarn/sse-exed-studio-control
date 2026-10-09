import { useRef, type MouseEvent } from "react";

import { Door, Key, LampWord, Room, Segmented } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot, PicturePlaces } from "@sse/engine-client";

import { cameraOf, clockTime, pictureLock, pictureShows, valuesLine } from "../cameras/camerasModel";
import { CameraPicture, type PictureAids } from "../cameras/pictures/CameraPicture";
import type { PictureFrames } from "../cameras/pictures/pictureFrames";
import {
  CENTRE,
  OVERVIEW_HERO,
  OVERVIEW_TILE,
  overviewLoupeRect,
  pointAt,
  WHOLE,
} from "../cameras/pictures/pictureGeometry";
import { usePicturePlaces } from "../cameras/pictures/picturePlaces";
import type { PictureViewControls } from "../cameras/pictures/pictureViewMemory";
import type { OverviewAlert } from "./overviewModel";
import styles from "./OverviewPicture.module.css";

// THE PICTURE (watch, green): CAM 1 as it is recorded, at two thirds of its
// pixels; beside it CAM 2, CAM 3 and CAM 1's loupe at a sixth, so focus is
// judged without leaving the page. They are the pictures helper's four, its
// limit; the Cameras page and the Overview are never on screen together, so
// the four never clash (the board's note 7). The aids, the loupe's zoom and
// its point are the Cameras page's (`usePictureView`); this page offers the
// guides and the zebras, and the peaking stays on Cameras.

export interface OverviewPictureProps {
  alert: OverviewAlert | null;
  drawnBy: "page" | "helper";
  frames: PictureFrames;
  snapshot: CamerasSnapshot | null;
  view: PictureViewControls;
  onOpen: () => void;
  onPlaces: ((places: PicturePlaces) => void) | null;
}

/** A picture's place when it does not arrive: its word and what arrives of it. */
function NoPicture({ camera }: { camera: CameraSnapshot }) {
  return (
    <span className={styles.noPicture} data-no-picture={camera.picture.state}>
      <LampWord tone={camera.picture.tone}>{camera.picture.word}</LampWord>
      <span className={styles.noPictureDetail}>{camera.picture.detail}</span>
    </span>
  );
}

/** A small picture with its caption: the camera and its state word. */
function Tile({
  camera,
  drawnBy,
  frames,
}: {
  camera: CameraSnapshot;
  drawnBy: "page" | "helper";
  frames: PictureFrames;
}) {
  return (
    <div className={styles.tile} data-testid={`overview-tile-${camera.camera}`}>
      <div className={styles.caption}>
        <span className={styles.captionName}>{camera.tag}</span>
        <LampWord tone={camera.tone}>{camera.word}</LampWord>
      </div>
      <div className={styles.small} data-well="">
        {pictureShows(camera) ? (
          <CameraPicture
            camera={camera.camera as CameraNumber}
            drawnBy={drawnBy}
            frames={frames}
            part={WHOLE}
            width={OVERVIEW_TILE.width}
            height={OVERVIEW_TILE.height}
            label={`${camera.tag}, ${camera.picture.detail}`}
            testId={`overview-cam${camera.camera}-picture`}
          />
        ) : (
          <NoPicture camera={camera} />
        )}
      </div>
    </div>
  );
}

export function OverviewPicture({ alert, drawnBy, frames, snapshot, view, onOpen, onPlaces }: OverviewPictureProps) {
  const places = useRef<HTMLDivElement>(null);
  usePicturePlaces(places, onPlaces);
  const cam1 = snapshot ? cameraOf(snapshot, 1) : null;
  const shows = cam1 ? pictureShows(cam1) : false;
  const lock = cam1 ? (pictureLock(cam1) ?? undefined) : "The cameras are not read yet.";
  const { aids, zoom, points } = view.view;
  const point = points[1];
  const loupe = overviewLoupeRect(point, zoom);
  // The peaking is the Cameras page's alone: this page has no key to turn it off.
  const heroAids: PictureAids = { guides: aids.guides, zebras: aids.zebras, peaking: false };
  const others = snapshot?.cameras.filter((camera) => camera.camera !== 1) ?? [];

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    // A press from the keyboard has no place: it puts the loupe back at the centre.
    if (event.detail === 0) {
      view.setPoint(1, CENTRE);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    view.setPoint(
      1,
      pointAt(WHOLE, { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height })
    );
  };

  const aidKey = (aid: "guides" | "zebras", label: string) => (
    <Key
      mode="toggle"
      size="small"
      engaged={aids[aid]}
      locked={!shows}
      reason={lock}
      testId={`overview-aid-${aid}`}
      onClick={() => view.toggleAid(aid)}
    >
      {label}
    </Key>
  );

  const lastRead = cam1 && (cam1.state === "unreachable" || cam1.valuesLastRead);
  const values = cam1 ? valuesLine(cam1) : "";
  const facts = cam1 ? (
    <>
      <span className={styles.factName}>{cam1.tag}</span>
      <LampWord tone={cam1.tone} testId="overview-picture-state">
        {cam1.word}
      </LampWord>
      {cam1.recording.recording === true ? (
        cam1.state === "unreachable" ? (
          <LampWord tone="attention">LAST KNOWN REC</LampWord>
        ) : (
          <LampWord tone="error">REC</LampWord>
        )
      ) : null}
      {/* The first fact to give way, so the aids and the door stand whole. */}
      <span className={styles.factValues} data-testid="overview-picture-values" data-cut-by-design="">
        {cam1.state === "unreachable"
          ? `the picture still comes from vMix${cam1.readAt ? ` · values last read ${clockTime(cam1.readAt)}` : ""}`
          : lastRead && values
            ? `${values} · last read`
            : values}
      </span>
    </>
  ) : null;

  return (
    <Room
      tone="green"
      name="The picture"
      job="watch"
      facts={facts}
      alert={alert}
      className={styles.room}
      testId="overview-room-picture"
      actions={
        <>
          <span className={styles.aids} role="group" aria-label="The picture's aids" data-testid="overview-aids">
            {aidKey("guides", "Guides")}
            {aidKey("zebras", "Zebras 95 %")}
          </span>
          <Door page="Cameras" testId="overview-door-cameras" onClick={onOpen} />
        </>
      }
    >
      <div ref={places} className={styles.pictures} data-testid="overview-pictures">
        {!snapshot || !cam1 ? (
          <p className={styles.waiting}>Reading the cameras…</p>
        ) : (
          <>
            <button
              type="button"
              className={styles.hero}
              data-well=""
              aria-label={shows ? `${cam1.tag}. Press it to move the loupe.` : `${cam1.tag}: no picture from vMix`}
              aria-disabled={shows ? undefined : "true"}
              data-testid="overview-hero"
              onClick={shows ? press : undefined}
            >
              {shows ? (
                <CameraPicture
                  camera={1}
                  drawnBy={drawnBy}
                  frames={frames}
                  part={WHOLE}
                  width={OVERVIEW_HERO.width}
                  height={OVERVIEW_HERO.height}
                  aids={heroAids}
                  marker={loupe}
                  label={`${cam1.tag}, ${cam1.picture.detail}`}
                  testId="overview-cam1-picture"
                />
              ) : (
                <NoPicture camera={cam1} />
              )}
            </button>
            <div className={styles.column}>
              {others.map((camera) => (
                <Tile key={camera.camera} camera={camera} drawnBy={drawnBy} frames={frames} />
              ))}
              <div className={styles.tile} data-testid="overview-loupe">
                <div className={styles.caption}>
                  <span className={styles.captionName}>Loupe</span>
                  <span className={styles.captionDetail}>{cam1.tag}</span>
                  <Segmented label="Loupe" className={styles.zoom} testId="overview-zoom">
                    {([2, 4] as const).map((step) => (
                      <Key
                        key={step}
                        mode="segmented"
                        size="small"
                        selected={zoom === step}
                        aria-pressed={zoom === step}
                        locked={!shows}
                        reason={lock}
                        testId={`overview-zoom-${step}`}
                        onClick={() => view.setZoom(step)}
                      >
                        {step}:1
                      </Key>
                    ))}
                  </Segmented>
                </div>
                <div className={styles.small} data-well="">
                  {shows ? (
                    <CameraPicture
                      camera={1}
                      drawnBy={drawnBy}
                      frames={frames}
                      part={loupe}
                      width={OVERVIEW_TILE.width}
                      height={OVERVIEW_TILE.height}
                      aids={{ guides: false, zebras: aids.zebras, peaking: false }}
                      pixels
                      label={`${cam1.tag} at ${zoom}:1`}
                      testId="overview-loupe-picture"
                    />
                  ) : (
                    <span className={styles.noPicture}>
                      <span className={styles.noPictureDetail}>No picture to check</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Room>
  );
}
