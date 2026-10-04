import { useEffect, useRef, useState } from "react";

import {
  ArmKey,
  ARM_TIMEOUT_MS,
  Key,
  LampWord,
  MenuButton,
  PlateHead,
  Readout,
  Readouts,
  Section,
  Slider,
  Tooltip,
  type ArmedKey,
  type UseArmResult,
} from "@sse/design-system";
import type { CameraLevel, CameraNumber, CameraPressSetting, CameraSnapshot } from "@sse/engine-client";

import { CamerasChoices, ChoiceRow, OnOffRow } from "./CamerasChoices";
import type { CamerasMenu } from "./camerasMenus";
import {
  cameraNumber,
  choiceStepLock,
  clockTime,
  colourRows,
  controlsLock,
  exposureRows,
  levelStepLock,
  levelText,
  linkLabel,
  releasedTo,
  sectionDetail,
  shutterUnit,
  type ChoiceRowView,
  type LevelRowView,
} from "./camerasModel";
import { CamerasTypedEntry } from "./CamerasTypedEntry";
import { CamerasValuesList } from "./CamerasValuesList";
import { armedInGroup, camerasArmKey, releaseArmed } from "./useCamerasArming";
import styles from "./CamerasPlate.module.css";

// The Cameras page's plate (board 2's right column): the selected camera.
// Who holds it, with Release (press twice) or Connect, and every value it
// reports (D10), in the unit the camera shows. Exposure, colour and focus
// are one press: a step key, a value from the list the camera allows, a
// typed number, or an auto the camera offers. The format, the picture
// profile and the display LUT are press twice (D11). A value the camera
// does not report says so in the camera's own words, and an unreachable
// camera's values are what it last reported, shown as doubt.
//
// The visual overhaul (2026-10-05): the values are the design system's
// readouts, and every list, typed value, format and look opens in a popover
// beside the plate, never a dialog, so the pictures stay drawn (each is one
// hole in their layer). One popover at a time. The format's and the look's
// keys arm inside their popover, which stays open while one is armed; any
// close of it drops the arm, so nothing armed is ever out of sight. The
// plate's title has the camera's ⋯, the same menu as its key and picture.
// The helper sentences are the section heads' tooltips; the safety lines
// (press twice, the lock, Release's warnings) stay on screen.

export interface CamerasPlateProps {
  camera: CameraSnapshot;
  armed: ArmedKey | null;
  /** The page's one arm: the popovers drop theirs when they close. */
  arm: UseArmResult;
  /** The selected camera's menu, as its key and its picture open it. */
  menu: CamerasMenu;
  /** CAM 1 is held and reports recording: a release leaves the take running. */
  mainRecording: boolean;
  onStep: (setting: CameraPressSetting, steps: number) => void;
  onSet: (setting: CameraPressSetting, value: string | number) => void;
  onAuto: (what: "focus" | "whiteBalance" | "iris") => void;
  onFormat: (setting: "resolution" | "frameRate", value: string) => void;
  onLook: (setting: "dynamicRange" | "displayLut" | "displayLutOn", value: string | boolean) => void;
  onRelease: () => void;
  onConnect: (camera: CameraNumber) => void;
  onReadAgain: (camera: CameraNumber) => void;
  onOpenSetup: () => void;
}

/**
 * The plate's one popover, and the camera it was opened for. A list or a typed
 * value names its setting only: its row is read from the camera at every
 * render, so what it shows is what the camera reports now.
 */
type OpenPopover =
  | { kind: "values"; camera: number; setting: ChoiceRowView["setting"] }
  | { kind: "typed"; camera: number; setting: LevelRowView["setting"] }
  | { kind: "format"; camera: number }
  | { kind: "look"; camera: number };

/** A section head's word with its helper sentence as the tooltip. */
function Head({ word, tip }: { word: string; tip: string }) {
  return (
    <Tooltip content={tip} placement="left">
      <span>{word}</span>
    </Tooltip>
  );
}

export function CamerasPlate({
  camera,
  armed,
  arm,
  menu,
  mainRecording,
  onStep,
  onSet,
  onAuto,
  onFormat,
  onLook,
  onRelease,
  onConnect,
  onReadAgain,
  onOpenSetup,
}: CamerasPlateProps) {
  const [popover, setPopover] = useState<OpenPopover | null>(null);
  // What the open popover stands beside (its row or its section), and the key
  // that opened it, a press on which closes it again; a press anywhere else
  // closes it too.
  const anchor = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const formatKey = useRef<HTMLSpanElement | null>(null);
  const lookKey = useRef<HTMLSpanElement | null>(null);
  const plateHead = useRef<HTMLDivElement | null>(null);
  const number = cameraNumber(camera);
  const lock = controlsLock(camera);
  const held = lock === null;
  const doubt = camera.state === "unreachable";
  const shown = camera.state === "held" || doubt;
  // A popover belongs to the camera it was opened for, while that camera is
  // held and, for a list or a typed value, reports the setting.
  const fresh = popover && popover.camera === camera.camera && held ? popover : null;
  const valuesRow =
    fresh?.kind === "values"
      ? (exposureRows(camera).find((row) => row.setting === fresh.setting && row.choice.reported) ?? null)
      : null;
  const typedRow =
    fresh?.kind === "typed"
      ? (colourRows(camera).find((row) => row.setting === fresh.setting && row.level.reported) ?? null)
      : null;
  const open = (fresh?.kind === "values" && !valuesRow) || (fresh?.kind === "typed" && !typedRow) ? null : fresh;
  useEffect(() => {
    if (popover && !open) setPopover(null);
  }, [popover, open]);

  const releaseKey = camerasArmKey.release(number);
  const releaseIsArmed = armed?.key === releaseKey;
  // Release armed here or in the camera's menu: either way the warning shows.
  const releaseAsked = releaseArmed(armed?.key, number);

  /** Closes the popover; the format's or the look's arm goes with it. */
  const close = () => {
    const key = arm.armed?.key;
    if (
      (open?.kind === "format" && armedInGroup(key, "format")) ||
      (open?.kind === "look" && armedInGroup(key, "look"))
    ) {
      arm.cancel();
    }
    setPopover(null);
  };

  /** Opens a popover beside `beside`, or closes it when `key` opened the one open. */
  const toggle = (next: OpenPopover, beside: HTMLElement | null, key: HTMLElement | null) => {
    if (open && open.kind === next.kind && opener.current === key) {
      close();
      return;
    }
    if (open) close();
    anchor.current = beside;
    opener.current = key;
    setPopover(next);
  };

  const stepKeys = (setting: CameraPressSetting, label: string, down: string | null, up: string | null) => (
    <>
      <Key
        className={styles.step}
        take
        locked={(lock ?? down) !== null}
        reason={lock ?? down ?? undefined}
        aria-label={`${label} one step down`}
        testId={`cameras-${setting}-down`}
        onClick={() => onStep(setting, -1)}
      >
        ‹
      </Key>
      <Key
        className={styles.step}
        take
        locked={(lock ?? up) !== null}
        reason={lock ?? up ?? undefined}
        aria-label={`${label} one step up`}
        testId={`cameras-${setting}-up`}
        onClick={() => onStep(setting, 1)}
      >
        ›
      </Key>
    </>
  );

  /**
   * A value: while the camera is held, a key that opens its list or its typed
   * entry, with the readout drawn inside; otherwise the readout alone, as
   * doubt or not read.
   */
  const value = (
    setting: CameraPressSetting,
    label: string,
    text: string,
    unit: string | null,
    isOpen: boolean,
    onPress: (beside: HTMLElement, key: HTMLElement) => void
  ) =>
    held ? (
      <button
        type="button"
        className={styles.value}
        data-take=""
        data-open={isOpen ? "" : undefined}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`${label} ${text}${unit ? `, as ${unit}` : ""}. Press for the values ${camera.tag} allows.`}
        data-testid={`cameras-${setting}-value`}
        // The popover stands beside the whole row, over the bay, so the plate stays in view.
        onClick={(event) => onPress(event.currentTarget.parentElement ?? event.currentTarget, event.currentTarget)}
      >
        <Readout value={text} unit={unit ?? undefined} className={styles.readout} />
      </button>
    ) : (
      <Readout
        value={shown ? text : "—"}
        unit={doubt ? "last read" : "not read"}
        doubt={doubt && shown}
        className={styles.valueWell}
        testId={`cameras-${setting}-value`}
      />
    );

  const notReported = (setting: string, label: string, sentence: string | null) => (
    <div key={setting} className={styles.set} data-testid={`cameras-${setting}`}>
      <span className={styles.setLabel}>{label}</span>
      <div className={styles.none} data-testid={`cameras-${setting}-not-reported`}>
        {sentence ?? `${camera.tag} does not report it.`}
      </div>
    </div>
  );

  const choiceRow = (row: ChoiceRowView) => {
    const { choice, label, setting } = row;
    if (!choice.reported) return notReported(setting, label, choice.notReported);
    return (
      <div key={setting} className={styles.set} data-testid={`cameras-${setting}`}>
        <span className={styles.setLabel}>{label}</span>
        {value(
          setting,
          label,
          choice.value ?? "—",
          setting === "shutter" ? shutterUnit(choice.value) : null,
          open?.kind === "values" && open.setting === setting,
          (beside, key) => toggle({ kind: "values", camera: camera.camera, setting }, beside, key)
        )}
        {stepKeys(
          setting,
          label,
          choiceStepLock(choice, camera.tag, label, -1),
          choiceStepLock(choice, camera.tag, label, 1)
        )}
      </div>
    );
  };

  const levelRow = (row: LevelRowView) => {
    const { label, level, setting } = row;
    if (!level.reported) return notReported(setting, label, level.notReported);
    return (
      <div key={setting} className={styles.set} data-testid={`cameras-${setting}`}>
        <span className={styles.setLabel}>{label}</span>
        {value(
          setting,
          label,
          levelText(level, setting === "tint"),
          null,
          open?.kind === "typed" && open.setting === setting,
          (beside, key) => toggle({ kind: "typed", camera: camera.camera, setting }, beside, key)
        )}
        {stepKeys(
          setting,
          label,
          levelStepLock(level, camera.tag, label, -1),
          levelStepLock(level, camera.tag, label, 1)
        )}
      </div>
    );
  };

  const once = (what: "focus" | "whiteBalance" | "iris", label: string) =>
    camera.auto[what] ? (
      <Key take locked={!held} reason={lock ?? undefined} testId={`cameras-auto-${what}`} onClick={() => onAuto(what)}>
        {label}
      </Key>
    ) : null;

  /** A section's quiet word: what locks it, or what its keys do. */
  const detail = (whenHeld?: string) => (held ? whenHeld : sectionDetail(camera, ""));

  /** A press-twice section's value, as the camera reports it, or why there is none. */
  const reported = (text: string | null, testId: string) => (
    <span className={styles.reported} data-doubt={doubt && text !== null ? "" : undefined} data-testid={testId}>
      {shown && text !== null ? text : "not read"}
      {doubt && text !== null ? <span className={styles.reportedNote}> · last read</span> : null}
    </span>
  );

  /** The key that opens a press-twice section's popover. */
  const changeKey = (kind: "format" | "look", ref: { current: HTMLSpanElement | null }, label: string) => (
    <span ref={ref} className={styles.opener}>
      <Key
        size="small"
        locked={!held}
        reason={lock ?? undefined}
        aria-haspopup="true"
        aria-expanded={open?.kind === kind}
        data-open={open?.kind === kind ? "" : undefined}
        aria-label={label}
        testId={`cameras-${kind}-open`}
        // The popover stands beside the whole section, over the bay, so the plate stays in view.
        onClick={() =>
          toggle({ kind, camera: camera.camera }, ref.current?.closest("section") ?? ref.current, ref.current)
        }
      >
        Change…
      </Key>
    </span>
  );

  const connection = () => {
    const last = clockTime(camera.readAt);
    switch (camera.state) {
      case "held":
        return {
          detail: linkLabel(camera),
          key: (
            <ArmKey
              armed={releaseIsArmed}
              timeoutMs={ARM_TIMEOUT_MS}
              countdownTestId="cameras-release-countdown"
              size="small"
              cap={releaseIsArmed ? "Release?" : undefined}
              testId="cameras-release"
              onClick={onRelease}
            >
              {releaseIsArmed ? undefined : `Release to ${releasedTo(camera)} · press twice`}
            </ArmKey>
          ),
        };
      case "released":
        return {
          detail: `to ${releasedTo(camera)} · not read`,
          key: (
            <Key size="small" mode="primary" testId="cameras-connect" onClick={() => onConnect(number)}>
              Connect
            </Key>
          ),
        };
      case "unreachable":
        return {
          detail: `${linkLabel(camera)} · ${last ? `last answer ${last}` : "no answer since the start"}`,
          key: (
            <Key size="small" mode="primary" testId="cameras-try-again" onClick={() => onReadAgain(number)}>
              Try again
            </Key>
          ),
        };
      case "not-set-up":
        return {
          detail: camera.link === "bluetooth" ? "not paired" : "no address",
          key: (
            <Key size="small" testId="cameras-plate-setup" onClick={onOpenSetup}>
              Camera setup
            </Key>
          ),
        };
    }
  };
  const { detail: connectionDetail, key: connectionKey } = connection();

  const note = releaseAsked
    ? camera.link === "bluetooth" && mainRecording
      ? { warn: true, text: "CAM 1 is recording: after Release, REC stops only on the camera or the iPad." }
      : { warn: false, text: `${releasedTo(camera)} can then reach ${camera.tag}. Connect takes it back.` }
    : camera.state === "released"
      ? {
          warn: false,
          text:
            camera.link === "bluetooth"
              ? "The iPad can reach CAM 1 now. REC here is locked until Connect."
              : `LUMIX Tether can reach ${camera.tag} now. Connect takes it back.`,
        }
      : null;

  const focus = camera.values.focus;
  const resolution = camera.values.resolution;
  const frameRate = camera.values.frameRate;
  const lut = camera.values.displayLut;
  const lutOn = camera.values.displayLutOn;
  const range = camera.values.dynamicRange;
  const lookShown = range.reported || lut.reported;

  return (
    <div className={styles.plate} data-testid="cameras-plate" data-camera={camera.camera}>
      {/* A right-click on the title opens the camera's menu, as its ⋯ does. */}
      <div ref={plateHead}>
        <PlateHead
          title={
            <Tooltip
              content={
                camera.recording.records
                  ? "Recording, timecode and card time are under REC. Not offered here: formatting a card, firmware, factory reset."
                  : `${camera.tag} does not record here; REC acts on CAM 1. Not offered here: formatting a card, firmware, factory reset.`
              }
              placement="left"
            >
              <span>{camera.tag}</span>
            </Tooltip>
          }
          sub={
            <>
              <span className={styles.subLine}>{camera.model} </span>
              <span className={styles.subLine}>vMix Output {camera.setup.vmixOutput}</span>
            </>
          }
          action={
            <MenuButton
              buttonLabel={`${camera.tag} menu`}
              buttonTestId="cameras-plate-menu"
              contextTarget={plateHead}
              menu={{ ...menu, arm }}
            />
          }
          testId="cameras-plate-head"
        />
      </div>

      <div className={styles.connectionBlock}>
        <div className={styles.connection} data-testid="cameras-connection">
          <div className={styles.connectionWords}>
            <LampWord tone={camera.tone} testId="cameras-connection-word">
              {camera.word}
            </LampWord>
            <span className={styles.connectionDetail}>{connectionDetail}</span>
          </div>
          {connectionKey}
        </div>
        {note ? (
          <p className={styles.fine} data-warn={note.warn ? "" : undefined} data-testid="cameras-connection-note">
            {note.text}
          </p>
        ) : null}
      </div>

      <Section
        title={<Head word="Exposure" tip={`One press: a step, or a value from the list ${camera.tag} allows.`} />}
        detail={detail()}
        testId="cameras-exposure"
      >
        {exposureRows(camera).map(choiceRow)}
        {once("iris", "Auto iris once")}
      </Section>

      <Section
        title={<Head word="Colour" tip="One press: a step, or press the value to type one." />}
        detail={detail()}
        testId="cameras-colour"
      >
        {colourRows(camera).map(levelRow)}
        {once("whiteBalance", "Auto white balance once")}
      </Section>

      <Section
        title={
          <Head
            word="Focus"
            tip={`One press. The focus is where ${camera.tag} reports its lens, from near 0 to far 1: a position, not a distance.`}
          />
        }
        detail={detail()}
        testId="cameras-focus"
      >
        {focus.reported ? (
          <FocusSlider doubt={doubt} level={focus} lock={lock} shown={shown} onSet={(next) => onSet("focus", next)} />
        ) : (
          notReported("focus", "Position", focus.notReported)
        )}
        <div className={styles.keys}>
          {camera.focusSteps ? (
            <>
              <Key
                take
                locked={!held}
                reason={lock ?? undefined}
                testId="cameras-focus-nearer"
                onClick={() => onStep("focus", -1)}
              >
                ‹ Nearer
              </Key>
              <Key
                take
                locked={!held}
                reason={lock ?? undefined}
                testId="cameras-focus-farther"
                onClick={() => onStep("focus", 1)}
              >
                Farther ›
              </Key>
            </>
          ) : null}
          {once("focus", "Autofocus once")}
        </div>
      </Section>

      <Section
        title={<Head word="Format" tip="Press twice: the picture drops while the format changes." />}
        detail={detail("press twice")}
        actions={changeKey("format", formatKey, `Change the format of ${camera.tag}`)}
        testId="cameras-format"
      >
        <Readouts
          rows={[
            {
              id: "resolution",
              label: "Resolution",
              value: reported(resolution.value, "cameras-resolution-value"),
            },
            {
              id: "frameRate",
              label: "Frame rate",
              value: reported(frameRate.value === null ? null : `${frameRate.value}p`, "cameras-frameRate-value"),
            },
          ]}
        />
      </Section>

      <Section
        title={<Head word="Profile and LUT" tip="The picture profile and the display LUT. Press twice." />}
        detail={lookShown ? detail("press twice") : undefined}
        actions={lookShown ? changeKey("look", lookKey, `Change the look of ${camera.tag}`) : undefined}
        testId="cameras-look"
      >
        {range.reported ? (
          <Readouts
            rows={[{ id: "range", label: "Dynamic range", value: reported(range.value, "cameras-dynamicRange-value") }]}
          />
        ) : (
          notReported("dynamicRange", "Profile", range.notReported)
        )}
        {lut.reported ? (
          <>
            <Readouts
              rows={[
                {
                  id: "lut",
                  label: "Display LUT",
                  value: reported(
                    lut.value === null
                      ? null
                      : lutOn.reported && lutOn.value !== null
                        ? `${lutOn.value ? "On" : "Off"} · ${lut.value}`
                        : lut.value,
                    "cameras-displayLut-value"
                  ),
                },
              ]}
            />
            {shown && lut.value === "Custom" ? (
              <p className={styles.fine}>{camera.tag} does not report a custom LUT's name.</p>
            ) : null}
          </>
        ) : (
          notReported("displayLut", "LUT", lut.notReported)
        )}
      </Section>

      {open?.kind === "values" && valuesRow ? (
        <CamerasValuesList
          key={`values:${valuesRow.setting}`}
          camera={camera}
          row={valuesRow}
          anchor={anchor}
          opener={opener}
          onClose={close}
          onPick={(picked) => {
            close();
            onSet(valuesRow.setting, picked);
          }}
        />
      ) : null}
      {open?.kind === "typed" && typedRow ? (
        <CamerasTypedEntry
          key={`typed:${typedRow.setting}`}
          camera={camera}
          row={typedRow}
          anchor={anchor}
          opener={opener}
          onClose={close}
          onSet={(typed) => {
            close();
            onSet(typedRow.setting, typed);
          }}
        />
      ) : null}
      {open?.kind === "format" ? (
        <CamerasChoices
          key="format"
          title={`Format · ${camera.tag}`}
          anchor={anchor}
          opener={opener}
          onClose={close}
          testId="cameras-format-popover"
        >
          <ChoiceRow
            armed={armed}
            group={{
              setting: "resolution",
              label: "Resolution",
              choice: resolution,
              unit: "",
              lock,
              armKey: (option) => camerasArmKey.format(number, "resolution", option),
              onPress: (option) => onFormat("resolution", option),
            }}
          />
          <ChoiceRow
            armed={armed}
            group={{
              setting: "frameRate",
              label: "Frame rate",
              choice: frameRate,
              unit: "p",
              lock,
              armKey: (option) => camerasArmKey.format(number, "frameRate", option),
              onPress: (option) => onFormat("frameRate", option),
            }}
          />
        </CamerasChoices>
      ) : null}
      {open?.kind === "look" ? (
        <CamerasChoices
          key="look"
          title={`Profile and LUT · ${camera.tag}`}
          anchor={anchor}
          opener={opener}
          onClose={close}
          testId="cameras-look-popover"
        >
          {range.reported ? (
            <ChoiceRow
              armed={armed}
              group={{
                setting: "dynamicRange",
                label: "Dynamic range",
                choice: range,
                unit: "",
                lock,
                armKey: (option) => camerasArmKey.look(number, "dynamicRange", option),
                onPress: (option) => onLook("dynamicRange", option),
              }}
            />
          ) : null}
          {lut.reported && lutOn.reported ? (
            <OnOffRow
              armed={armed}
              group={{
                setting: "displayLutOn",
                label: "Display LUT",
                value: lutOn.value,
                lock,
                armKey: (on) => camerasArmKey.look(number, "displayLutOn", on),
                onPress: (on) => onLook("displayLutOn", on),
              }}
            />
          ) : null}
          {lut.reported ? (
            <ChoiceRow
              armed={armed}
              group={{
                setting: "displayLut",
                label: "LUT",
                choice: lut,
                unit: "",
                lock,
                tall: true,
                armKey: (option) => camerasArmKey.look(number, "displayLut", option),
                onPress: (option) => onLook("displayLut", option),
              }}
            />
          ) : null}
        </CamerasChoices>
      ) : null}
    </div>
  );
}

interface FocusSliderProps {
  level: CameraLevel;
  lock: string | null;
  doubt: boolean;
  shown: boolean;
  onSet: (value: number) => void;
}

/** Focus as the camera reports it: a position from near 0 to far 1, not a distance. */
function FocusSlider({ level, lock, doubt, shown, onSet }: FocusSliderProps) {
  // The value under the hand while it moves; the camera's own once let go.
  const [moving, setMoving] = useState<number | null>(null);
  const span = level.max - level.min || 1;
  const reported = level.value ?? level.min;
  const value = moving ?? reported;
  const onStep = (share: number) => {
    const raw = level.min + share * span;
    return level.step > 0 ? Number((Math.round(raw / level.step) * level.step).toFixed(4)) : raw;
  };
  return (
    <>
      <div className={styles.focus}>
        <Slider
          label="Focus"
          value={(value - level.min) / span}
          step={level.step > 0 ? level.step / span : 0.01}
          locked={lock !== null}
          doubt={doubt}
          take
          valueText={value.toFixed(2)}
          testId="cameras-focus-slider"
          onChange={(share) => setMoving(onStep(share))}
          onCommit={(share) => {
            const next = onStep(share);
            setMoving(null);
            if (next !== reported) onSet(next);
          }}
        />
        <span className={styles.focusValue} data-doubt={doubt ? "" : undefined} data-testid="cameras-focus-value">
          {shown && level.value !== null ? value.toFixed(2) : "—"}
        </span>
      </div>
      <div className={styles.nearFar}>
        <span>near</span>
        <span>far</span>
      </div>
    </>
  );
}
