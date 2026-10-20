import { Key, Lamp, LampWord, LevelBar, Segmented } from "@sse/design-system";
import type { Session, SessionDrive, SessionSnapshot } from "@sse/engine-client";

import { bytesWord, driveLabel, driveOf, letterOf, levelTone, levelWord, spaceWords, usedShare } from "./sessionDisk";
import {
  lastRateLine,
  leafOf,
  parentLine,
  parentPath,
  vmixLine,
  vmixRateLine,
  type FolderChoice,
  type FolderRow,
} from "./sessionModel";
import styles from "./SessionWorkspace.module.css";

// The window's right column (D52; board 3, `docs/design/session-3.md`): where
// the session's folder goes, and the drive it is on. In a new session's
// window: `New folder` (on the sessions' folder, or in the folder `Change…`
// chose, named after the session as it is typed, with the kind's subfolders)
// or `An existing one` (the kind's last folder, the newest other one, or one
// Windows' folder dialog chose). In the running session's window: its folder
// with `Open the folder`, vMix's line with `Copy the path`, and the disk. The
// disk row is the drive's free space of its size, a level bar, and how long it
// lasts. Nothing here makes a folder: Begin does.

interface DiskRowProps {
  /** The drive's letter, `D`; `null` before anything names one. */
  letter: string | null;
  snapshot: SessionSnapshot | null;
  /** The line under the bar, beside the level's word: how long the space lasts. */
  line: (drive: SessionDrive & { freeBytes: number }) => string | null;
}

/** The drive a folder is on (`session-disk`): its name, its free space of its size, a level bar and its line. */
export function DiskRow({ letter, snapshot, line }: DiskRowProps) {
  const drive = driveOf(snapshot, letter);
  const space = drive ? spaceWords(drive) : null;
  let quiet: { tone: "off" | "attention" | "error"; words: string } | null = null;
  if (!snapshot || snapshot.readAt === null || letter === null) {
    quiet = { tone: "off", words: "The drives have not been read yet." };
  } else if (!drive) {
    quiet = { tone: "error", words: `${letter}: is not there.` };
  } else if (!drive.answering || !space) {
    quiet = { tone: "attention", words: "The drive of this folder does not answer." };
  }
  if (quiet || !drive || !space || drive.freeBytes === null) {
    return (
      <div className={styles.disk} data-testid="session-disk" data-state={quiet?.tone ?? "off"}>
        <p className={styles.diskQuiet}>
          {quiet && quiet.tone !== "off" ? <Lamp tone={quiet.tone} /> : null}
          <span>{quiet?.words}</span>
        </p>
      </div>
    );
  }
  const level = levelWord(drive.level);
  const words = line({ ...drive, freeBytes: drive.freeBytes });
  return (
    <div className={styles.disk} data-testid="session-disk" data-level={drive.level ?? undefined}>
      <div className={styles.diskTop}>
        <span className={styles.diskName}>{driveLabel(drive)}</span>
        <span className={styles.diskSpace}>
          <b data-tone={level?.tone}>{space.free}</b> free of {space.total}
        </span>
      </div>
      <LevelBar
        used={usedShare(drive)}
        tone={levelTone(drive.level)}
        label={driveLabel(drive)}
        className={styles.diskBar}
        testId="session-disk-bar"
      />
      {level || words ? (
        <p className={styles.diskLine} data-testid="session-disk-line">
          {level ? (
            <span className={styles.diskWord}>
              <LampWord tone={level.tone}>{level.word}</LampWord>
            </span>
          ) : null}
          {words ? <span>{words}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

interface NewFolderColumnProps {
  snapshot: SessionSnapshot | null;
  choice: FolderChoice;
  /** The sessions' folder a new folder goes on: the setting's, or the run's own. */
  root: string;
  /** The new folder's name, following the session's name as it is typed. */
  leaf: string;
  /** The new folder is on the sessions' folder already: used as it is. */
  exists: boolean;
  subfolders: readonly string[];
  rows: readonly FolderRow[];
  /** The row chosen: the first unless the operator chose another. */
  chosen: number;
  /** The kind's last session: its folder's rate is the disk's line. */
  last: Session | null;
  onMode: (mode: FolderChoice["mode"]) => void;
  onChange: () => void;
  onPick: (path: string) => void;
  onChooseOther: () => void;
}

/** A new session's right column: `Folder`, its switch, the folder Begin makes or uses, and its drive. */
export function NewFolderColumn({
  snapshot,
  choice,
  root,
  leaf,
  exists,
  subfolders,
  rows,
  chosen,
  last,
  onMode,
  onChange,
  onPick,
  onChooseOther,
}: NewFolderColumnProps) {
  const parent = choice.parent ?? root;
  const path = `${parentLine(parent)}${leaf}`;
  const chosenRow = rows[chosen] ?? null;
  const letterPath = choice.mode === "new" ? parent : (chosenRow?.path ?? root);
  return (
    <div className={styles.column} data-testid="session-folder" data-mode={choice.mode}>
      <div className={styles.columnHead}>
        <span>Folder</span>
        <Segmented label="The session's folder" className={styles.folderSwitch} testId="session-folder-switch">
          <Key
            mode="segmented"
            size="small"
            selected={choice.mode === "new"}
            aria-pressed={choice.mode === "new"}
            testId="session-folder-new"
            onClick={() => onMode("new")}
          >
            New folder
          </Key>
          <Key
            mode="segmented"
            size="small"
            selected={choice.mode === "existing"}
            aria-pressed={choice.mode === "existing"}
            testId="session-folder-existing"
            onClick={() => onMode("existing")}
          >
            An existing one
          </Key>
        </Segmented>
      </div>
      {choice.mode === "new" ? (
        <>
          <div className={styles.well} data-testid="session-folder-well">
            <span className={styles.path}>
              <span className={styles.parent} data-cut-by-design="" title={parentLine(parent)}>
                {parentLine(parent)}
              </span>
              <span className={styles.leaf} data-cut-by-design="" title={path} data-testid="session-folder-leaf">
                {leaf}
              </span>
            </span>
            <Key size="small" testId="session-folder-change" onClick={onChange}>
              Change…
            </Key>
          </div>
          <div className={styles.tags} data-testid="session-subfolders">
            {exists
              ? null
              : subfolders.map((name) => (
                  <span key={name} className={styles.tag}>
                    {name}
                  </span>
                ))}
            <span className={styles.when}>{exists ? "exists · used as it is" : "made at Begin"}</span>
          </div>
        </>
      ) : (
        <>
          {rows.length > 0 ? (
            <div className={styles.rows} role="group" aria-label="Folders that exist" data-testid="session-folder-rows">
              {rows.map((row, index) => {
                const on = index === chosen;
                return (
                  <button
                    key={row.path}
                    type="button"
                    className={styles.row}
                    aria-pressed={on}
                    title={row.path}
                    data-testid={`session-folder-row-${index}`}
                    onClick={() => onPick(row.path)}
                  >
                    <span className={styles.radio} data-on={on ? "" : undefined} aria-hidden="true" />
                    <span className={styles.rowName} data-cut-by-design="">
                      {leafOf(row.path)}
                    </span>
                    {row.bytes !== null ? (
                      <span className={styles.rowSize}>{row.bytes === 0 ? "empty" : bytesWord(row.bytes)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.noFolder} data-testid="session-folder-none">
              No session&apos;s folder yet: choose one with Windows&apos; folder dialog.
            </p>
          )}
          <div className={styles.tags}>
            <Key size="small" testId="session-folder-choose" onClick={onChooseOther}>
              Choose another folder…
            </Key>
            <span className={styles.when}>a series&apos; folder, or one on another drive</span>
          </div>
        </>
      )}
      <DiskRow
        letter={letterOf(letterPath)}
        snapshot={snapshot}
        line={(drive) => lastRateLine(last, drive.freeBytes)}
      />
    </div>
  );
}

interface RunningFolderColumnProps {
  snapshot: SessionSnapshot | null;
  running: Session;
  last: Session | null;
  onOpen: () => void;
  onCopy: (path: string) => void;
}

/** The running session's right column: its folder, vMix's recording and the drive. */
export function RunningFolderColumn({ snapshot, running, last, onOpen, onCopy }: RunningFolderColumnProps) {
  const folder = running.folder;
  const vmix = snapshot?.vmix ?? null;
  const line = folder && vmix ? vmixLine(vmix, folder) : null;
  const letter = snapshot?.sessionDrive ?? letterOf(folder);
  return (
    <div className={styles.column} data-testid="session-folder" data-mode="running">
      <div className={styles.columnHead}>
        <span>Folder</span>
      </div>
      {folder ? (
        <div className={styles.well} data-testid="session-folder-well">
          <span className={styles.path}>
            <span className={styles.parent} data-cut-by-design="" title={parentLine(parentPath(folder))}>
              {parentLine(parentPath(folder))}
            </span>
            <span className={styles.leaf} data-cut-by-design="" title={folder} data-testid="session-folder-leaf">
              {leafOf(folder)}
            </span>
          </span>
          <Key size="small" testId="session-folder-open" onClick={onOpen}>
            Open the folder
          </Key>
        </div>
      ) : (
        <div className={styles.well} data-testid="session-folder-well" data-none="">
          <span className={styles.wellQuiet}>This session began before sessions had folders.</span>
        </div>
      )}
      {line && vmix ? (
        <div className={styles.vmix} data-testid="session-vmix" data-tone={line.tone}>
          <Lamp tone={line.tone} className={styles.vmixLamp} />
          <span className={styles.vmixSay} data-testid="session-vmix-line">
            {line.sentence}
          </span>
          {line.copy && vmix.recordingFolder ? (
            <Key
              size="small"
              className={styles.vmixKey}
              title={vmix.recordingFolder}
              testId="session-vmix-copy"
              onClick={() => onCopy(vmix.recordingFolder!)}
            >
              Copy the path
            </Key>
          ) : null}
        </div>
      ) : null}
      <DiskRow
        letter={letter}
        snapshot={snapshot}
        line={(drive) =>
          vmix?.recording && vmix.bytesPerSecond && vmix.file && letterOf(vmix.file) === drive.letter
            ? vmixRateLine(vmix.bytesPerSecond, drive.freeBytes)
            : lastRateLine(last, drive.freeBytes)
        }
      />
    </div>
  );
}
