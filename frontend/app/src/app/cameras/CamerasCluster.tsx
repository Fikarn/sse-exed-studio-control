import {
  ArmKey,
  Key,
  LampWord,
  LatchSlot,
  MenuButton,
  Section,
  Segmented,
  StateDisplay,
  type ArmedKey,
  type MenuEntry,
} from "@sse/design-system";
import type { CameraDialBank, CameraNumber, CamerasSnapshot } from "@sse/engine-client";

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
} from "./camerasModel";
import { STOP_WINDOW_MS } from "./perform";
import styles from "./CamerasCluster.module.css";

// The Cameras page's cluster (board 2's left column): the state display with
// its armed row, the take — REC, which is CAM 1's whichever camera is
// selected (D14), and what is known about the take —, the three cameras,
// what the Stream Deck's dials set, where the pictures come from and whether
// each arrives, who changed what, and the standing actions.

/** The rows the Recent list has room for: what the hardware link sends. */
const RECENT_ROOM = 5;

export interface CamerasClusterProps {
  snapshot: CamerasSnapshot;
  state: CamerasStateView;
  armed: ArmedKey | null;
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

export function CamerasCluster({
  snapshot,
  state,
  armed,
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
  // standing commands, with the same handlers; the row of keys that held them
  // went, so the cluster keeps its room for the latch slot under the 80 px
  // header (the Recent list's five rows at two lines).
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
        armed={armed ? { text: `${armed.label} · press again`, timeoutMs: armed.timeoutMs } : null}
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

      <Section title="Recording" detail="CAM 1 only · whichever camera is selected" testId="cameras-recording">
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
        <dl className={styles.take} data-testid="cameras-take">
          {takeReadouts(main, now).map((row) => (
            <div
              key={row.id}
              className={styles.takeRow}
              data-lines={row.id === "card" ? "2" : undefined}
              data-testid={`cameras-take-${row.id}`}
            >
              <dt>{row.label}</dt>
              <dd>
                {row.value !== null ? <b data-doubt={row.doubt ? "" : undefined}>{row.value}</b> : null}
                {row.note ? <span>{row.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Cameras" detail="press one: the picture and the plate follow" testId="cameras-list">
        <div className={styles.cameras} role="group" aria-label="Cameras">
          {snapshot.cameras.map((entry) => {
            const camera = cameraKeyView(entry, snapshot.selected);
            return (
              <button
                key={camera.camera}
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
                <span className={styles.cameraTag}>{camera.tag}</span>
                <span className={styles.cameraWords}>
                  {camera.rec === "recording" ? (
                    <LampWord tone="error">REC</LampWord>
                  ) : camera.rec === "last-known" ? (
                    <LampWord tone="attention" cap={false}>
                      last known REC
                    </LampWord>
                  ) : null}
                  <LampWord tone={camera.tone} cap={false}>
                    {camera.word}
                  </LampWord>
                </span>
                <span className={styles.cameraMeta}>{camera.meta}</span>
                <span className={styles.cameraValues} data-kind={camera.valuesKind}>
                  <span className={styles.cameraLine}>{camera.values}</span>
                  {camera.valuesTag ? <span className={styles.cameraValuesTag}>{camera.valuesTag}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {dials ? (
        <Section title="Stream Deck" detail="CAMERAS page · what the dials set" testId="cameras-dials">
          <Segmented label="What the Stream Deck's dials set" className={styles.banks} testId="cameras-bank">
            {DIAL_BANKS.map((entry) => (
              <Key
                key={entry.bank}
                mode="segmented"
                engaged={dials.bank === entry.bank}
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

      <Section title="Pictures" detail={snapshot.pictures.source} testId="cameras-pictures">
        <ul className={styles.pictures}>
          {pictureRows(snapshot).map((row) => (
            <li key={row.camera} className={styles.pictureRow} data-testid={`cameras-picture-row-${row.camera}`}>
              <span className={styles.pictureTag}>{row.tag}</span>
              <span className={styles.pictureDetail}>{row.detail}</span>
              <LampWord tone={row.tone} cap={false} className={styles.pictureWord}>
                {row.word}
              </LampWord>
            </li>
          ))}
        </ul>
        <p className={styles.fine}>{snapshot.pictures.note}</p>
      </Section>

      <Section
        title="Recent"
        detail="who changed what"
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
