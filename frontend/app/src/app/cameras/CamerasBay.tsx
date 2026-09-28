import type { MouseEvent } from "react";

import { Key, LampWord, Segmented } from "@sse/design-system";
import type { CameraNumber, CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

import { cameraNumber, releasedTo } from "./camerasModel";
import { CameraPicture, type PictureAids } from "./pictures/CameraPicture";
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

export interface CamerasBayProps {
  snapshot: CamerasSnapshot;
  selected: CameraSnapshot;
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
}

/** The REC tag beside a camera's name, where it is CAM 1 and it records. */
function RecTag({ camera }: { camera: CameraSnapshot }) {
  if (!camera.recording.records || camera.recording.recording !== true) return null;
  return camera.state === "unreachable" ? (
    <LampWord tone="attention" cap={false}>
      last known REC
    </LampWord>
  ) : (
    <LampWord tone="error">REC</LampWord>
  );
}

export function CamerasBay({
  snapshot,
  selected,
  view,
  aids,
  zoom,
  point,
  onView,
  onToggleAid,
  onZoom,
  onMoveLoupe,
  onSelect,
}: CamerasBayProps) {
  const camera = cameraNumber(selected);
  const part = bigRect(view, point);
  const loupe = loupeRect(point, zoom);
  const others = snapshot.cameras.filter((entry) => entry.camera !== selected.camera);
  const lockNote =
    selected.state === "released"
      ? `released to ${releasedTo(selected)} · not read`
      : selected.state === "unreachable"
        ? "not answering · controls locked"
        : selected.state === "not-set-up"
          ? "not set up · controls locked"
          : null;

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
    <Key mode="toggle" size="small" engaged={aids[aid]} testId={`cameras-aid-${aid}`} onClick={() => onToggleAid(aid)}>
      {label}
    </Key>
  );

  return (
    <div className={styles.bay} data-testid="cameras-bay">
      <div className={styles.caption} data-testid="cameras-caption">
        <span className={styles.title}>
          <b>{selected.tag}</b> {selected.model}
        </span>
        <LampWord tone={selected.tone} cap={false} testId="cameras-caption-state">
          {selected.word.toLowerCase()}
        </LampWord>
        <RecTag camera={selected} />
        <span className={styles.detail} data-testid="cameras-caption-detail">
          vMix input {selected.setup.vmixInput} · test picture ·{" "}
          {view === "one-to-one"
            ? `1:1 · ${HERO.width} × ${HERO.height} of ${WHOLE.width} × ${WHOLE.height}`
            : `shown at ${bigViewWord(view)}`}
        </span>
        {lockNote ? (
          <span className={styles.lockNote} data-tone={selected.tone} data-testid="cameras-caption-lock">
            {lockNote}
          </span>
        ) : null}
        <div className={styles.aids} role="group" aria-label="The big picture">
          <Segmented label="How the big picture is shown" className={styles.view} testId="cameras-view">
            <Key
              mode="segmented"
              size="small"
              engaged={view === "whole"}
              aria-pressed={view === "whole"}
              testId="cameras-view-whole"
              onClick={() => onView("whole")}
            >
              Whole frame
            </Key>
            <Key
              mode="segmented"
              size="small"
              engaged={view === "one-to-one"}
              aria-pressed={view === "one-to-one"}
              testId="cameras-view-one-to-one"
              onClick={() => onView("one-to-one")}
            >
              1:1
            </Key>
          </Segmented>
          <span className={styles.aidsNote}>on this screen only</span>
          {aidKey("guides", "Guides")}
          {aidKey("peaking", "Peaking")}
          {aidKey("zebras", "Zebras 95 %")}
        </div>
      </div>

      <button
        type="button"
        className={styles.hero}
        data-well=""
        aria-label={`${selected.tag}, the big picture. Press it to move the loupe.`}
        data-testid="cameras-hero"
        onClick={press}
      >
        <CameraPicture
          camera={camera}
          part={part}
          width={HERO.width}
          height={HERO.height}
          aids={aids}
          marker={view === "whole" ? loupe : null}
          label={`${selected.tag}, a test picture`}
          testId="cameras-hero-picture"
        />
      </button>

      <div className={styles.row}>
        {others.map((entry) => (
          <button
            key={entry.camera}
            type="button"
            className={styles.tile}
            data-well=""
            aria-label={`Select ${entry.tag}`}
            data-testid={`cameras-tile-${entry.camera}`}
            onClick={() => onSelect(cameraNumber(entry))}
          >
            <CameraPicture
              camera={cameraNumber(entry)}
              part={WHOLE}
              width={TILE.width}
              height={TILE.height}
              label={`${entry.tag}, a test picture`}
            />
            <span className={styles.chip}>
              <b>{entry.tag}</b>
              <LampWord tone={entry.tone} cap={false}>
                {entry.word.toLowerCase()}
              </LampWord>
              <RecTag camera={entry} />
            </span>
          </button>
        ))}

        <section className={styles.loupe} aria-label="Loupe" data-testid="cameras-loupe">
          <div className={styles.loupeHead}>
            <span className={styles.loupeTitle}>Loupe</span>
            <span className={styles.loupeNote}>press the big picture to move it</span>
            <Segmented label="Loupe" className={styles.zoom} testId="cameras-zoom">
              <Key
                mode="segmented"
                size="small"
                cap="2:1"
                engaged={zoom === 2}
                aria-pressed={zoom === 2}
                testId="cameras-zoom-2"
                onClick={() => onZoom(2)}
              />
              <Key
                mode="segmented"
                size="small"
                cap="4:1"
                engaged={zoom === 4}
                aria-pressed={zoom === 4}
                testId="cameras-zoom-4"
                onClick={() => onZoom(4)}
              />
            </Segmented>
          </div>
          <div className={styles.loupeBody} data-well="">
            <CameraPicture
              camera={camera}
              part={loupe}
              width={LOUPE.width}
              height={LOUPE.height}
              aids={{ guides: false, zebras: aids.zebras, peaking: aids.peaking }}
              pixels
              label={`${selected.tag} at ${zoom}:1`}
              testId="cameras-loupe-picture"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
