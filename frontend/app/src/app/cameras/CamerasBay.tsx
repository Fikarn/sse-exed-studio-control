import { useRef, type MouseEvent } from "react";

import { Key, LampWord, MenuButton, Segmented, Tooltip, type UseArmResult } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot, PicturePlaces } from "@sse/engine-client";

import type { CamerasMenu } from "./camerasMenus";
import { cameraNumber, pictureLock, pictureShows } from "./camerasModel";
import { CameraPicture, type PictureAids } from "./pictures/CameraPicture";
import type { PictureFrames } from "./pictures/pictureFrames";
import { usePicturePlaces } from "./pictures/picturePlaces";
import {
  CENTRE,
  HERO,
  LOUPE,
  TILE,
  WHOLE,
  bigRect,
  bigViewWord,
  loupeRect,
  pointAt,
  type BigView,
  type LoupeZoom,
  type Point,
} from "./pictures/pictureGeometry";
import styles from "./CamerasBay.module.css";

// The Cameras page's bay (board 2): a caption row, the selected camera's
// picture big with nothing drawn over it but the aids the operator switched
// on, and under it the other two small, with the loupe beside them. Pressing
// a small picture selects that camera (D19: one selection). Pressing the big
// picture moves the point the loupe and the 1:1 view look at.
//
// The aids are this screen's own: they are drawn on Studio Control's copy of
// the picture and reach neither the camera nor vMix.
//
// A picture that does not arrive (the hardware link's `picture`) leaves its
// place empty with the hardware link's words in it (board 2's `no-pictures`
// and `one-picture`), and while the selected camera's does not, the view, the
// aids and the loupe are locked. The camera's own controls still work.
//
// In the app's window the pictures helper draws the pictures over the page
// (D30): the bay says where each picture stands, its aids and where the
// loupe looks, and what it draws over one, a small picture's chip
// (`picturePlaces.ts`). The helper draws the aids and the marker with the
// page's numbers (`pictureAids.ts`).
//
// The visual overhaul (2026-10-05): a small picture's chip holds its ⋯, the
// camera's menu, and a right-click on the picture opens the same menu. The
// chip is already a hole in the pictures' layer, so the ⋯ costs no other; a
// ⋯ anywhere else on the picture would be drawn over in the app's window.
// The current view and zoom are drawn as the selection, not lit.
//
// The polish (2026-10-05): the caption names the camera by its tag and word,
// as the small pictures' chips do; its model stands on the camera's key and
// the plate's title, and a lock stands in the state display, the plate's
// connection well and each section's head, so the caption repeats neither.
// The loupe's head is inset as the caption is.

export interface CamerasBayProps {
  snapshot: CamerasSnapshot;
  selected: CameraSnapshot;
  /** Who draws the pictures: the page (a browser) or the pictures helper over it (the app's window). */
  drawnBy: "page" | "helper";
  /** The cameras' newest frames, which each view draws as they come, where the page draws. */
  frames: PictureFrames;
  /** Where the bay's places are said; `null` in a window with no pictures. */
  onPlaces: ((places: PicturePlaces) => void) | null;
  view: BigView;
  aids: PictureAids;
  zoom: LoupeZoom;
  /** Where the loupe looks on the selected camera's picture. */
  point: Point;
  onView: (view: BigView) => void;
  onToggleAid: (aid: keyof PictureAids) => void;
  onZoom: (zoom: LoupeZoom) => void;
  onMoveLoupe: (point: Point) => void;
  onSelect: (camera: CameraNumber) => void;
  /** The page's one arm, which every menu shares. */
  arm: UseArmResult;
  /** A camera's menu, as its key, its small picture and the plate's title open it. */
  cameraMenu: (camera: CameraSnapshot, testIdPrefix: string) => CamerasMenu;
}

/**
 * A picture's place when it does not arrive: its word and, big, why and what to check;
 * small, what arrives of it.
 */
function NoPicture({ camera, big }: { camera: CameraSnapshot; big: boolean }) {
  const { picture } = camera;
  return (
    <span
      className={[styles.noPicture, big ? "" : styles.noPictureSmall].filter(Boolean).join(" ")}
      data-no-picture={picture.state}
      data-testid={big ? "cameras-no-picture" : `cameras-no-picture-${camera.camera}`}
    >
      <LampWord tone={picture.tone} className={styles.noPictureWord}>
        {picture.word}
      </LampWord>
      {big && picture.sentence ? <span className={styles.noPictureSentence}>{picture.sentence}</span> : null}
      {big ? (
        picture.advice ? (
          <span className={styles.noPictureDetail}>{picture.advice}</span>
        ) : null
      ) : (
        <span className={styles.noPictureDetail}>{picture.detail}</span>
      )}
    </span>
  );
}

/** The REC tag beside a camera's name, where it is CAM 1 and it records. */
function RecTag({ camera }: { camera: CameraSnapshot }) {
  if (!camera.recording.records || camera.recording.recording !== true) return null;
  return camera.state === "unreachable" ? (
    <LampWord tone="attention">LAST KNOWN REC</LampWord>
  ) : (
    <LampWord tone="error">REC</LampWord>
  );
}

interface TileProps {
  camera: CameraSnapshot;
  drawnBy: "page" | "helper";
  frames: PictureFrames;
  menu: CamerasMenu;
  arm: UseArmResult;
  onSelect: (camera: CameraNumber) => void;
}

/**
 * A small picture: a press selects its camera (D19: one selection). Its chip
 * stands over it, a sibling of the picture's key since a key cannot hold the
 * chip's ⋯.
 */
function Tile({ camera, drawnBy, frames, menu, arm, onSelect }: TileProps) {
  const tile = useRef<HTMLDivElement>(null);
  const number = cameraNumber(camera);
  return (
    <div ref={tile} className={styles.tileWrap}>
      <button
        type="button"
        className={styles.tile}
        data-well=""
        aria-label={`Select ${camera.tag}`}
        data-testid={`cameras-tile-${camera.camera}`}
        onClick={() => onSelect(number)}
      >
        {pictureShows(camera) ? (
          <CameraPicture
            camera={number}
            drawnBy={drawnBy}
            frames={frames}
            part={WHOLE}
            width={TILE.width}
            height={TILE.height}
            label={`${camera.tag}, ${camera.picture.detail}`}
          />
        ) : (
          <NoPicture camera={camera} big={false} />
        )}
      </button>
      <span className={styles.chip} data-picture-hole="" data-testid={`cameras-tile-chip-${camera.camera}`}>
        <b>{camera.tag}</b>
        <LampWord tone={camera.tone}>{camera.word}</LampWord>
        <RecTag camera={camera} />
        <MenuButton
          buttonLabel={`${camera.tag} menu`}
          buttonTestId={`cameras-tile-menu-${camera.camera}`}
          contextTarget={tile}
          size="sm"
          menu={{ ...menu, arm }}
        />
      </span>
    </div>
  );
}

export function CamerasBay({
  snapshot,
  selected,
  drawnBy,
  frames,
  onPlaces,
  view,
  aids: aidsOn,
  zoom,
  point,
  onView,
  onToggleAid,
  onZoom,
  onMoveLoupe,
  onSelect,
  arm,
  cameraMenu,
}: CamerasBayProps) {
  const bay = useRef<HTMLDivElement>(null);
  usePicturePlaces(bay, onPlaces);
  const camera = cameraNumber(selected);
  const shows = pictureShows(selected);
  const lock = pictureLock(selected) ?? undefined;
  const aids = aidsOn;
  const part = bigRect(view, point);
  const loupe = loupeRect(point, zoom);
  const others = snapshot.cameras.filter((entry) => entry.camera !== selected.camera);

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    // A press from the keyboard has no place: it puts the loupe back at the centre.
    if (event.detail === 0) {
      onMoveLoupe(CENTRE);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    onMoveLoupe(
      pointAt(part, {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      })
    );
  };

  const aidKey = (aid: keyof PictureAids, label: string) => (
    <Key
      mode="toggle"
      size="small"
      engaged={aids[aid]}
      locked={!shows}
      reason={lock}
      testId={`cameras-aid-${aid}`}
      onClick={() => onToggleAid(aid)}
    >
      {label}
    </Key>
  );

  return (
    <div ref={bay} className={styles.bay} data-testid="cameras-bay">
      <div className={styles.caption} data-testid="cameras-caption">
        <span className={styles.title}>{selected.tag}</span>
        <LampWord tone={selected.tone} testId="cameras-caption-state">
          {selected.word}
        </LampWord>
        <RecTag camera={selected} />
        <span className={styles.detail} data-testid="cameras-caption-detail">
          {selected.picture.detail}
          {shows
            ? view === "one-to-one"
              ? ` · 1:1 · ${HERO.width} × ${HERO.height} of ${WHOLE.width} × ${WHOLE.height}`
              : ` · shown at ${bigViewWord(view)}`
            : null}
        </span>
        <div className={styles.aids} role="group" aria-label="The big picture">
          <Tooltip
            content="The view and the aids are this screen's own: they reach neither the camera nor vMix."
            placement="bottom"
          >
            <span className={styles.aidsWord}>This screen</span>
          </Tooltip>
          <Segmented label="How the big picture is shown" className={styles.view} testId="cameras-view">
            <Key
              mode="segmented"
              size="small"
              selected={view === "whole"}
              aria-pressed={view === "whole"}
              locked={!shows}
              reason={lock}
              testId="cameras-view-whole"
              onClick={() => onView("whole")}
            >
              Whole frame
            </Key>
            <Key
              mode="segmented"
              size="small"
              selected={view === "one-to-one"}
              aria-pressed={view === "one-to-one"}
              locked={!shows}
              reason={lock}
              testId="cameras-view-one-to-one"
              onClick={() => onView("one-to-one")}
            >
              1:1
            </Key>
          </Segmented>
          {aidKey("guides", "Guides")}
          {aidKey("peaking", "Peaking")}
          {aidKey("zebras", "Zebras 95 %")}
        </div>
      </div>

      <button
        type="button"
        className={styles.hero}
        data-well=""
        aria-label={
          shows
            ? `${selected.tag}, the big picture. Press it to move the loupe.`
            : `${selected.tag}: no picture from vMix`
        }
        aria-disabled={shows ? undefined : "true"}
        data-testid="cameras-hero"
        onClick={shows ? press : undefined}
      >
        {shows ? (
          <CameraPicture
            camera={camera}
            drawnBy={drawnBy}
            frames={frames}
            part={part}
            width={HERO.width}
            height={HERO.height}
            aids={aids}
            marker={view === "whole" ? loupe : null}
            label={`${selected.tag}, ${selected.picture.detail}`}
            testId="cameras-hero-picture"
          />
        ) : (
          <NoPicture camera={selected} big />
        )}
      </button>

      <div className={styles.row}>
        {others.map((entry) => (
          <Tile
            key={entry.camera}
            camera={entry}
            drawnBy={drawnBy}
            frames={frames}
            menu={cameraMenu(entry, `cameras-tile-menu-${entry.camera}`)}
            arm={arm}
            onSelect={onSelect}
          />
        ))}

        <section className={styles.loupe} aria-label="Loupe" data-testid="cameras-loupe">
          <div className={styles.loupeHead}>
            <Tooltip
              content={
                shows
                  ? "Each of the picture's pixels as it is. Press the big picture to move where it looks."
                  : "There is no picture to check."
              }
              placement="top"
            >
              <span className={styles.loupeTitle}>Loupe</span>
            </Tooltip>
            <Segmented label="Loupe" className={styles.zoom} testId="cameras-zoom">
              <Key
                mode="segmented"
                size="small"
                selected={zoom === 2}
                aria-pressed={zoom === 2}
                locked={!shows}
                reason={lock}
                testId="cameras-zoom-2"
                onClick={() => onZoom(2)}
              >
                2:1
              </Key>
              <Key
                mode="segmented"
                size="small"
                selected={zoom === 4}
                aria-pressed={zoom === 4}
                locked={!shows}
                reason={lock}
                testId="cameras-zoom-4"
                onClick={() => onZoom(4)}
              >
                4:1
              </Key>
            </Segmented>
          </div>
          <div className={styles.loupeBody} data-well="">
            {shows ? (
              <CameraPicture
                camera={camera}
                drawnBy={drawnBy}
                frames={frames}
                part={loupe}
                width={LOUPE.width}
                height={LOUPE.height}
                aids={{ guides: false, zebras: aids.zebras, peaking: aids.peaking }}
                pixels
                label={`${selected.tag} at ${zoom}:1`}
                testId="cameras-loupe-picture"
              />
            ) : (
              <span className={styles.noPicture} data-testid="cameras-loupe-empty">
                <span className={styles.noPictureDetail}>No picture to check</span>
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
