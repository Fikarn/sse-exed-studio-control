import { ArmKey, Key, LampWord, Section, StateDisplay, type ArmedKey } from "@sse/design-system";
import type { CameraNumber, CamerasSnapshot } from "@sse/engine-client";

import { cameraKeyView, cameraOf, recentRows, recKeyView, takeReadouts, type CamerasStateView } from "./camerasModel";
import { STOP_WINDOW_MS } from "./perform";
import styles from "./CamerasCluster.module.css";

// The Cameras page's cluster (board 2's left column): the state display with
// its armed row, the take — REC, which is CAM 1's whichever camera is
// selected (D14), and what is known about the take —, the three cameras,
// where the pictures come from, who changed what, and the standing actions.
// What the dials set waits for the deck's CAMERAS page.

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
          ) : undefined
        }
        // The REC key and the plate's own keys say that they are armed; the
        // row says what the second press does.
        armed={armed ? { text: `${armed.label} · press again`, timeoutMs: armed.timeoutMs } : null}
        data-camera={state.camera}
        testId="cameras-state-display"
      />

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
            <div key={row.id} className={styles.takeRow} data-testid={`cameras-take-${row.id}`}>
              <dt>{row.label}</dt>
              <dd>
                {row.value !== null ? <b data-doubt={row.doubt ? "" : undefined}>{row.value}</b> : null}
                {row.note ? <span>{row.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Cameras" detail="press one to select it" testId="cameras-list">
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
        <p className={styles.fine}>The big picture and the plate follow the camera selected here.</p>
      </Section>

      <Section title="Pictures" detail="test pictures" testId="cameras-pictures">
        <ul className={styles.pictures}>
          {snapshot.cameras.map((camera) => (
            <li key={camera.camera} className={styles.pictureRow}>
              <span className={styles.pictureTag}>{camera.tag}</span>
              <span className={styles.pictureDetail}>vMix input {camera.setup.vmixInput} · test picture</span>
            </li>
          ))}
        </ul>
        <p className={styles.fine}>
          The cameras' own pictures come with a later version, over NDI from vMix on this PC. Until then these are test
          pictures.
        </p>
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

      <div className={styles.standing}>
        <Key size="small" testId="cameras-read-all" onClick={() => onReadAgain(null)}>
          Read all cameras again
        </Key>
        <Key size="small" testId="cameras-open-setup" onClick={onOpenSetup}>
          Camera setup
        </Key>
      </div>
    </div>
  );
}
