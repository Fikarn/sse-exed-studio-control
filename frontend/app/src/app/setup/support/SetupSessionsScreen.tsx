import { useState } from "react";

import { Key, LampWord, LevelBar, NumberEntryDialog } from "@sse/design-system";
import type { SessionDrive, SessionKind, SessionSnapshot } from "@sse/engine-client";

import { SESSION_KINDS } from "../../session/kinds";
import { driveLabel, letterOf, levelTone, levelWord, spaceWords, usedShare } from "../../session/sessionDisk";
import { refusalWords, samePath } from "../../session/sessionModel";
import { openSessionFolder, pickFolder } from "../../shellCommands";
import { SetupRecordSection, SetupStepScreen } from "../components/SetupStepScreen";
import type { SetupPilot } from "../useSetupPilot";
import styles from "./SetupSessionsScreen.module.css";

// Setup / Support's fifth screen (D52; the owner's answer of 2026-10-19: built
// without a board, in the Console and Cameras screens' language): where each
// session's folder is made, what goes in it, and the drives' space. The
// sessions' folder, `D:\Sessions` on new saved data, which the first Begin
// makes; each kind's subfolders, which a Begin makes in a new session's
// folder; the two levels under which the disk reads Low and Nearly full; and
// every lettered drive as the hardware link's sessions' watch last read it.
// Saving writes the settings alone: nothing here makes, moves or deletes a
// folder or a file.

/** The levels a number is typed for. */
type Level = "low" | "nearly-full";

/** `Audio, Video, vMix Recording` read back into the names a Begin makes. */
function namesOf(text: string): string[] {
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** A drive's row: its letter and name, its space, its level, and what it is to the sessions. */
function DriveRow({ drive, sessions }: { drive: SessionDrive; sessions: boolean }) {
  const space = drive.answering ? spaceWords(drive) : null;
  const level = levelWord(drive.level);
  return (
    <div className={styles.drive} data-testid={`setup-sessions-drive-${drive.letter}`}>
      <div className={styles.driveTop}>
        <span className={styles.driveName}>{driveLabel(drive)}</span>
        {sessions ? <span className={styles.driveTag}>sessions&apos; folder</span> : null}
        {space && level ? (
          <span className={styles.driveWord}>
            <LampWord tone={level.tone}>{level.word}</LampWord>
          </span>
        ) : null}
        {space ? (
          <span className={styles.driveSpace}>
            <b data-tone={level?.tone}>{space.free}</b> free of {space.total}
          </span>
        ) : (
          <span className={styles.driveSpace} data-tone="attention">
            does not answer
          </span>
        )}
      </div>
      {space ? <LevelBar used={usedShare(drive)} tone={levelTone(drive.level)} label={driveLabel(drive)} /> : null}
    </div>
  );
}

export interface SetupSessionsScreenProps {
  editor: SetupPilot;
  sessionSnapshot: SessionSnapshot | null;
}

export function SetupSessionsScreen({ editor, sessionSnapshot }: SetupSessionsScreenProps) {
  const { store } = editor.props;
  const { busyAction } = editor.state;
  const { performAction } = editor.actions;
  const busy = busyAction !== null;
  // Each kind's subfolders as typed and not saved yet; a field without an entry shows what Setup holds.
  const [drafts, setDrafts] = useState<Partial<Record<SessionKind, string>>>({});
  // The level whose number is being typed.
  const [typing, setTyping] = useState<Level | null>(null);

  if (!sessionSnapshot) {
    return (
      <SetupStepScreen
        title="Sessions"
        lead="Where each session's folder is made, what goes in it, and the drives' space. Begin makes the folder; nothing here touches a file."
        facts={
          <p className={styles.waiting} data-testid="setup-sessions-waiting">
            Reading the sessions…
          </p>
        }
        testId="setup-screen-sessions"
      />
    );
  }

  const { settings, places, drives } = sessionSnapshot;
  const rootLetter = letterOf(places.root);

  const changeRoot = () =>
    void performAction("sessions-root", async () => {
      let answer: string | null;
      try {
        answer = await pickFolder(settings.root, "root");
      } catch (error) {
        throw new Error(refusalWords(error, "Windows' folder dialog did not open."), { cause: error });
      }
      if (answer === null || samePath(answer, settings.root)) return null;
      const reply = await store.updateSessionSettings({ root: answer });
      const root = settingsRootOf(reply) ?? answer;
      return {
        message: `The sessions' folder is ${root} now: the next Begin makes its folder there.`,
        tone: "ok" as const,
      };
    });

  const openRoot = () =>
    void performAction("sessions-open", async () => {
      try {
        await openSessionFolder("root");
      } catch (error) {
        throw new Error(refusalWords(error, "The sessions' folder was not opened."), { cause: error });
      }
      return { message: `Opened ${places.root} in Explorer.`, tone: "ok" as const };
    });

  const saveSubfolders = (kind: SessionKind, name: string, text: string) =>
    void performAction(`sessions-subfolders-${kind}`, async () => {
      const names = namesOf(text);
      await store.updateSessionSettings({ subfolders: { [kind]: names } });
      setDrafts((typed) => {
        const rest = { ...typed };
        delete rest[kind];
        return rest;
      });
      return {
        message:
          names.length === 0
            ? `${name} has no subfolders now: Begin makes its folder alone.`
            : `${name}'s subfolders: ${names.join(", ")}. Begin makes them in a new session's folder.`,
        tone: "ok" as const,
      };
    });

  const setLevel = (level: Level, value: number) => {
    setTyping(null);
    const low = level === "low" ? value : settings.lowBelowGb;
    const nearlyFull = level === "nearly-full" ? value : settings.nearlyFullBelowGb;
    void performAction(`sessions-${level}`, async () => {
      await store.updateSessionSettings(level === "low" ? { lowBelowGb: value } : { nearlyFullBelowGb: value });
      return {
        message: `The disk reads Low under ${low} GB and Nearly full under ${nearlyFull} GB.`,
        tone: "ok" as const,
      };
    });
  };

  const rootMissing = `${places.root} is not there yet: the first Begin makes it.`;

  return (
    <>
      <SetupStepScreen
        title="Sessions"
        lead="Where each session's folder is made, what goes in it, and the drives' space. Begin makes the folder; nothing here touches a file."
        facts={
          <div className={styles.blocks}>
            <section className={styles.block} aria-label="The sessions' folder" data-testid="setup-sessions-folder">
              <span className={styles.blockLabel}>The sessions&apos; folder</span>
              <div className={styles.row}>
                <span className={styles.label}>Folder</span>
                <span className={styles.value} title={settings.root} data-testid="setup-sessions-root">
                  {settings.root}
                </span>
                <span className={styles.keys}>
                  <Key size="small" disabled={busy} testId="setup-sessions-root-change" onClick={changeRoot}>
                    Change…
                  </Key>
                  <Key
                    size="small"
                    disabled={busy}
                    locked={!places.rootExists}
                    reason={places.rootExists ? undefined : rootMissing}
                    testId="setup-sessions-root-open"
                    onClick={openRoot}
                  >
                    Open
                  </Key>
                </span>
              </div>
              {places.simulated ? (
                <p className={styles.line} data-testid="setup-sessions-simulated">
                  This run keeps its sessions&apos; folders in {places.root}, beside its own saved data; the
                  studio&apos;s build uses the folder above.
                </p>
              ) : null}
            </section>

            <section
              className={styles.block}
              aria-label="Each kind's subfolders"
              data-testid="setup-sessions-subfolders"
            >
              <span className={styles.blockLabel}>Each kind&apos;s subfolders</span>
              {SESSION_KINDS.map((kind) => {
                const saved = settings.subfolders[kind.id].join(", ");
                const text = drafts[kind.id] ?? saved;
                const changed = text !== saved;
                return (
                  <div key={kind.id} className={styles.row}>
                    <label className={styles.label} htmlFor={`setup-sessions-subfolders-${kind.id}`}>
                      {kind.name}
                    </label>
                    <input
                      id={`setup-sessions-subfolders-${kind.id}`}
                      className={styles.field}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="no subfolders"
                      value={text}
                      data-testid={`setup-sessions-subfolders-${kind.id}`}
                      onChange={(event) => setDrafts((typed) => ({ ...typed, [kind.id]: event.target.value }))}
                    />
                    <Key
                      size="small"
                      disabled={busy}
                      locked={!changed}
                      reason={changed ? undefined : `These are the subfolders Setup holds for ${kind.name}.`}
                      testId={`setup-sessions-subfolders-${kind.id}-save`}
                      onClick={() => saveSubfolders(kind.id, kind.name, text)}
                    >
                      Save
                    </Key>
                  </div>
                );
              })}
              <p className={styles.line}>
                Begin makes these in a new session&apos;s folder, the names separated by commas. A folder that exists is
                used as it is.
              </p>
            </section>

            <section className={styles.block} aria-label="When the disk reads low" data-testid="setup-sessions-levels">
              <span className={styles.blockLabel}>When the disk reads low</span>
              <div className={styles.row}>
                <span className={styles.label}>Low under</span>
                <span className={styles.value} data-testid="setup-sessions-low">
                  {settings.lowBelowGb} GB
                </span>
                <Key size="small" disabled={busy} testId="setup-sessions-low-change" onClick={() => setTyping("low")}>
                  Change…
                </Key>
              </div>
              <div className={styles.row}>
                <span className={styles.label}>Nearly full under</span>
                <span className={styles.value} data-testid="setup-sessions-nearly-full">
                  {settings.nearlyFullBelowGb} GB
                </span>
                <Key
                  size="small"
                  disabled={busy}
                  testId="setup-sessions-nearly-full-change"
                  onClick={() => setTyping("nearly-full")}
                >
                  Change…
                </Key>
              </div>
              <p className={styles.line}>
                In Explorer&apos;s GB. The window&apos;s disk row and the footer&apos;s Disk say it, and the header
                shows a Disk chip while the session&apos;s drive reads low.
              </p>
            </section>
          </div>
        }
        record={
          <SetupRecordSection
            title="Drives"
            detail={drives.length === 1 ? "1 drive" : `${drives.length} drives`}
            testId="setup-sessions-drives"
          >
            {sessionSnapshot.readAt === null ? (
              <p className={styles.waiting} data-testid="setup-sessions-drives-unread">
                The drives have not been read yet.
              </p>
            ) : (
              drives.map((drive) => (
                <DriveRow key={drive.letter} drive={drive} sessions={drive.letter === rootLetter} />
              ))
            )}
          </SetupRecordSection>
        }
        testId="setup-screen-sessions"
      />
      {typing ? (
        <NumberEntryDialog
          title={typing === "low" ? "The disk reads Low under" : "The disk reads Nearly full under"}
          fieldLabel={typing === "low" ? "Low under" : "Nearly full under"}
          initialValue={typing === "low" ? settings.lowBelowGb : settings.nearlyFullBelowGb}
          min={1}
          max={100_000}
          step={1}
          suffix="GB"
          confirmLabel="Save"
          onCancel={() => setTyping(null)}
          onConfirm={(value) => setLevel(typing, value)}
        />
      ) : null}
    </>
  );
}

/** The sessions' folder a settings' update answers with (`{ settings }`). */
function settingsRootOf(reply: unknown): string | null {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const settings = (reply as { settings?: { root?: unknown } }).settings;
  return typeof settings?.root === "string" ? settings.root : null;
}
