import { useRef } from "react";

import {
  ArmKey,
  Key,
  LampWord,
  LatchSlot,
  MenuButton,
  Readouts,
  Section,
  Segmented,
  StateDisplay,
  Tooltip,
  type ArmedKey,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";
import type { CameraDialBank, CameraNumber, CameraSnapshot, CamerasSnapshot } from "@sse/engine-client";

import type { CamerasMenu } from "./camerasMenus";
import {
  cameraKeyView,
  cameraOf,
  DIAL_BANKS,
  dialsView,
  pictureRows,
  recentRows,
  recKeyView,
  takeReadouts,
  type CamerasStateView,
  type TakeReadout,
} from "./camerasModel";
import { STOP_WINDOW_MS } from "./perform";
import styles from "./CamerasCluster.module.css";

// The Cameras page's cluster (board 2's left column): the state display with
// its armed row, the take — REC, which is CAM 1's whichever camera is
// selected (D14), and what is known about the take —, the three cameras,
// what the Stream Deck's dials set, where the pictures come from and whether
// each arrives, and who changed what. The visual overhaul (2026-10-05): each
// camera's key has its ⋯ beside it, with the same menu as its small picture
// and the plate's title; the state words are the hardware link's, in
// capitals; the helper sentences are the section heads' tooltips.

/** The rows the Recent list has room for: what the hardware link sends. */
const RECENT_ROOM = 5;

export interface CamerasClusterProps {
  snapshot: CamerasSnapshot;
  state: CamerasStateView;
  armed: ArmedKey | null;
  /** What the armed row says before "· press again". */
  armedWords: string | null;
  /** The page's one arm, which every menu shares. */
  arm: UseArmResult;
  /** A camera's menu, as its key, its small picture and the plate's title open it. */
  cameraMenu: (camera: CameraSnapshot, testIdPrefix: string) => CamerasMenu;
  /** The clock the take's length is counted against. */
  now: number;
  onRecord: () => void;
  onSelect: (camera: CameraNumber) => void;
  /** What the Stream Deck's dials set on the selected camera. */
  onBank: (bank: CameraDialBank) => void;
  onConnect: (camera: CameraNumber) => void;
  /** One read of the cameras; `camera` is the one the key names, `null` for all three. */
  onReadAgain: (camera: CameraNumber | null) => void;
  onOpenSetup: () => void;
  onOpenActions: () => void;
}

/** A section head's word with its helper sentence as the tooltip. */
function Head({ word, tip }: { word: string; tip: string }) {
  return (
    <Tooltip content={tip} placement="right">
      <span>{word}</span>
    </Tooltip>
  );
}

/** A take row's value: the number, and what it is in a few words; the whole sentence on hover. */
function TakeValue({ row }: { row: TakeReadout }) {
  const value = (
    <span className={styles.takeValue} data-testid={`cameras-take-${row.id}`}>
      {row.value !== null ? <b data-doubt={row.doubt ? "" : undefined}>{row.value}</b> : null}
      {row.note ? <span className={styles.takeNote}>{row.note}</span> : null}
    </span>
  );
  return row.explain ? (
    <Tooltip content={row.explain} placement="right">
      {value}
    </Tooltip>
  ) : (
    value
  );
}

interface CameraKeyProps {
  entry: CameraSnapshot;
  selected: number;
  menu: CamerasMenu;
  arm: UseArmResult;
  onSelect: (camera: CameraNumber) => void;
}

/**
 * A camera's key and its ⋯. The key is the take-time control (it selects); the
 * ⋯ stands beside it, inside its edge, since a key cannot hold a key. A
 * right-click anywhere on the row opens the same menu.
 */
function CameraKey({ entry, selected, menu, arm, onSelect }: CameraKeyProps) {
  const row = useRef<HTMLDivElement>(null);
  const camera = cameraKeyView(entry, selected);
  return (
    <div ref={row} className={styles.cameraRow}>
      <button
        type="button"
        className={styles.camera}
        data-material="key"
        data-take=""
        data-selected={camera.selected ? "" : undefined}
        data-state={camera.state}
        aria-pressed={camera.selected}
        data-testid={`cameras-key-${camera.camera}`}
        onClick={() => onSelect(camera.camera)}
      >
        <span className={styles.cameraHead}>
          <span className={styles.cameraTag}>{camera.tag}</span>
          <span className={styles.cameraWords}>
            {camera.rec === "recording" ? (
              <LampWord tone="error">REC</LampWord>
            ) : camera.rec === "last-known" ? (
              <LampWord tone="attention">LAST KNOWN REC</LampWord>
            ) : null}
            <LampWord tone={camera.tone}>{camera.word}</LampWord>
          </span>
        </span>
        <span className={styles.cameraMeta}>{camera.meta}</span>
        <span className={styles.cameraValues} data-kind={camera.valuesKind}>
          <span className={styles.cameraLine}>{camera.values}</span>
          {camera.valuesTag ? <span className={styles.cameraValuesTag}>{camera.valuesTag}</span> : null}
        </span>
      </button>
      <span className={styles.cameraMenu}>
        <MenuButton
          buttonLabel={`${camera.tag} menu`}
          buttonTestId={`cameras-key-menu-${camera.camera}`}
          contextTarget={row}
          size="sm"
          menu={{ ...menu, arm }}
        />
      </span>
    </div>
  );
}

export function CamerasCluster({
  snapshot,
  state,
  armed,
  armedWords,
  arm,
  cameraMenu,
  now,
  onRecord,
  onSelect,
  onBank,
  onConnect,
  onReadAgain,
  onOpenSetup,
  onOpenActions,
}: CamerasClusterProps) {
  const main = cameraOf(snapshot, 1);
  const rec = recKeyView(main);
  const stopArmed = armed?.key === "stop";
  const recent = snapshot.recent === null ? null : recentRows(snapshot.recent).slice(0, RECENT_ROOM);
  const wayOut = state.wayOut;
  const dials = dialsView(snapshot);
  // The shell (overhaul 3): the page's ⋯ on the state display holds the
  // standing commands, with the same handlers.
  const pageMenu: MenuEntry[] = [
    { id: "read-all", label: "Read all cameras again", onSelect: () => onReadAgain(null), testId: "cameras-read-all" },
    { id: "all-actions", label: "All actions", onSelect: onOpenActions },
    { kind: "divider", id: "divider" },
    { id: "setup", label: "Camera setup", onSelect: onOpenSetup, testId: "cameras-open-setup" },
  ];

  return (
    <div className={styles.cluster} data-testid="cameras-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta}
        actions={
          wayOut?.kind === "connect" ? (
            <Key size="small" mode="primary" testId="cameras-state-connect" onClick={() => onConnect(wayOut.camera)}>
              {wayOut.label}
            </Key>
          ) : wayOut?.kind === "read-again" ? (
            <Key
              size="small"
              mode="primary"
              testId="cameras-state-read-again"
              onClick={() => onReadAgain(wayOut.camera)}
            >
              {wayOut.label}
            </Key>
          ) : wayOut?.kind === "setup" ? (
            <Key size="small" testId="cameras-state-setup" onClick={onOpenSetup}>
              {wayOut.label}
            </Key>
          ) : wayOut?.kind === "look-again" ? (
            <Key size="small" mode="primary" testId="cameras-state-look-again" onClick={() => onReadAgain(null)}>
              {wayOut.label}
            </Key>
          ) : undefined
        }
        // The REC key and the plate's own keys say that they are armed; the
        // row says what the second press does.
        armed={armed ? { text: `${armedWords ?? armed.label} · press again`, timeoutMs: armed.timeoutMs } : null}
        data-camera={state.camera}
        testId="cameras-state-display"
        menu={
          <MenuButton
            buttonLabel="Cameras menu"
            buttonTestId="cameras-page-menu"
            menu={{ head: { title: "Cameras" }, items: pageMenu }}
          />
        }
      />

      {/* The shell (overhaul 3): the latch slot, the same on every page. */}
      <LatchSlot testId="cameras-latch-slot" />

      <Section
        title={<Head word="Recording" tip="REC is CAM 1's, whichever camera is selected." />}
        testId="cameras-recording"
      >
        {rec.kind === "recording" ? (
          <ArmKey
            hazard
            armed={stopArmed}
            timeoutMs={STOP_WINDOW_MS}
            countdownTestId="cameras-stop-countdown"
            cap={stopArmed ? "Stop?" : "Rec"}
            hint={rec.hint}
            layout="stack"
            size="tall"
            take
            className={styles.rec}
            data-rec="recording"
            aria-label={
              stopArmed ? "Stop armed. Press again to stop CAM 1." : "CAM 1 reports recording. Press twice to stop."
            }
            testId="cameras-rec"
            onClick={onRecord}
          />
        ) : rec.kind === "start" ? (
          <Key
            cap="Rec"
            hint={rec.hint}
            layout="stack"
            size="tall"
            take
            className={styles.rec}
            data-rec="stopped"
            aria-label="Start recording on CAM 1"
            testId="cameras-rec"
            onClick={onRecord}
          />
        ) : (
          <Key
            cap="Rec"
            hint={rec.hint}
            layout="stack"
            size="tall"
            take
            locked
            reason={rec.reason}
            className={[styles.rec, rec.kind === "last-known" ? styles.recDoubt : ""].filter(Boolean).join(" ")}
            data-rec={rec.kind}
            data-doubt={rec.kind === "last-known" ? "" : undefined}
            testId="cameras-rec"
          >
            {rec.kind === "last-known" ? (
              <span className={styles.recWhy}>STOP is locked until CAM 1 answers</span>
            ) : null}
          </Key>
        )}
        <Readouts
          className={styles.take}
          data-testid="cameras-take"
          rows={takeReadouts(main, now).map((row) => ({
            id: row.id,
            label: row.label,
            value: <TakeValue row={row} />,
          }))}
        />
      </Section>

      <Section
        title={<Head word="Cameras" tip="Press one: the big picture and the plate follow it." />}
        testId="cameras-list"
      >
        <div className={styles.cameras} role="group" aria-label="Cameras">
          {snapshot.cameras.map((entry) => (
            <CameraKey
              key={entry.camera}
              entry={entry}
              selected={snapshot.selected}
              menu={cameraMenu(entry, `cameras-key-menu-${entry.camera}`)}
              arm={arm}
              onSelect={onSelect}
            />
          ))}
        </div>
      </Section>

      {dials ? (
        <Section
          title={
            <Head
              word="Stream Deck"
              tip="The deck's CAMERAS page: what its dials set on the selected camera. It sends nothing to a camera."
            />
          }
          testId="cameras-dials"
        >
          <Segmented label="What the Stream Deck's dials set" className={styles.banks} testId="cameras-bank">
            {DIAL_BANKS.map((entry) => (
              <Key
                key={entry.bank}
                mode="segmented"
                selected={dials.bank === entry.bank}
                aria-pressed={dials.bank === entry.bank}
                testId={`cameras-bank-${entry.bank}`}
                onClick={() => onBank(entry.bank)}
              >
                {entry.label}
              </Key>
            ))}
          </Segmented>
          <p className={styles.fine} data-live={dials.live ? "" : undefined} data-testid="cameras-dials-hint">
            {dials.hint}
          </p>
        </Section>
      ) : null}

      <Section
        title={<Head word="Pictures" tip={snapshot.pictures.note} />}
        detail={snapshot.pictures.source}
        testId="cameras-pictures"
      >
        <ul className={styles.pictures}>
          {pictureRows(snapshot).map((row) => (
            <li key={row.camera} className={styles.pictureRow} data-testid={`cameras-picture-row-${row.camera}`}>
              <span className={styles.pictureTag}>{row.tag}</span>
              <span className={styles.pictureDetail}>{row.detail}</span>
              <LampWord tone={row.tone} className={styles.pictureWord}>
                {row.word}
              </LampWord>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={<Head word="Recent" tip="Who changed what on the cameras: the newest five, with who did it." />}
        className={styles.recentSection}
        actions={
          <Key size="small" testId="cameras-all-actions" onClick={onOpenActions}>
            All actions…
          </Key>
        }
        testId="cameras-recent"
      >
        {recent === null ? (
          <p className={styles.fine} data-testid="cameras-recent-unread">
            The recent actions could not be read. The cameras' state above is as the cameras report it.
          </p>
        ) : recent.length === 0 ? (
          <p className={styles.fine} data-testid="cameras-recent-empty">
            Nothing yet. A take, a format, a look and who holds a camera show here, with who did it.
          </p>
        ) : (
          <ol className={styles.recent}>
            {recent.map((row) => (
              <li key={row.id} className={styles.recentRow} data-testid="cameras-recent-row">
                <time className={styles.recentTime}>{row.time}</time>
                <span className={styles.recentText}>{row.text}</span>
                <span className={styles.recentSource}>{row.source}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
