import { useState, type ReactNode } from "react";

import {
  ArmKey,
  ARM_TIMEOUT_MS,
  Key,
  LampWord,
  NumberEntryDialog,
  PlateHead,
  Section,
  Segmented,
  Slider,
  type ArmedKey,
} from "@sse/design-system";
import type { CameraChoice, CameraLevel, CameraNumber, CameraPressSetting, CameraSnapshot } from "@sse/engine-client";

import { CamerasValuesList } from "./CamerasValuesList";
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
  unavailableReason,
  type ChoiceRowView,
  type LevelRowView,
} from "./camerasModel";
import styles from "./CamerasPlate.module.css";

// The Cameras page's plate (board 2's right column): the selected camera.
// Who holds it, with Release (press twice) or Connect, and every value it
// reports (D10), in the unit the camera shows. Exposure, colour and focus
// are one press: a step key, a value from the list the camera allows, a
// typed number, or an auto the camera offers. The format, the picture
// profile and the display LUT are press twice (D11). A value the camera
// does not report says so in the camera's own words, and an unreachable
// camera's values are what it last reported, shown as doubt.

export interface CamerasPlateProps {
  camera: CameraSnapshot;
  armed: ArmedKey | null;
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

/** Which list of values is open: a choice of the selected camera's. */
interface OpenList {
  camera: number;
  row: ChoiceRowView;
}

/** Which level is being typed. */
interface TypedLevel {
  camera: number;
  row: LevelRowView;
}

export function CamerasPlate({
  camera,
  armed,
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
  const [list, setList] = useState<OpenList | null>(null);
  const [typed, setTyped] = useState<TypedLevel | null>(null);
  const number = cameraNumber(camera);
  const lock = controlsLock(camera);
  const held = lock === null;
  const doubt = camera.state === "unreachable";
  const shown = camera.state === "held" || doubt;
  // A list or a typed value belongs to the camera it was opened for, while that camera is held.
  const openList = list && list.camera === camera.camera && held ? list : null;
  const openTyped = typed && typed.camera === camera.camera && held ? typed : null;
  const releaseKey = `release:${number}`;
  const releaseArmed = armed?.key === releaseKey;

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

  /** A readout that is also a key: it opens the list, or the typed entry. */
  const readout = (
    setting: CameraPressSetting,
    label: string,
    value: string,
    unit: string | null,
    open: boolean,
    onPress: () => void
  ) =>
    held ? (
      <button
        type="button"
        className={styles.readout}
        data-well=""
        data-open={open ? "" : undefined}
        data-take=""
        aria-label={`${label} ${value}${unit ? `, as ${unit}` : ""}. Press for the values ${camera.tag} allows.`}
        data-testid={`cameras-${setting}-value`}
        onClick={onPress}
      >
        <b>{value}</b>
        {unit ? <span>{unit}</span> : null}
      </button>
    ) : (
      <div
        className={styles.readout}
        data-well=""
        data-doubt={doubt && shown ? "" : undefined}
        data-testid={`cameras-${setting}-value`}
      >
        <b data-dim={shown ? undefined : ""}>{shown ? value : "—"}</b>
        <span>{doubt ? "last read" : "not read"}</span>
      </div>
    );

  const notReported = (setting: string, label: string, sentence: string | null) => (
    <div key={setting} className={styles.set} data-testid={`cameras-${setting}`}>
      <span className={styles.setLabel}>{label}</span>
      <div className={styles.none} data-well="" data-testid={`cameras-${setting}-not-reported`}>
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
        {readout(
          setting,
          label,
          choice.value ?? "—",
          setting === "shutter" ? shutterUnit(choice.value) : null,
          openList?.row.setting === setting,
          () => setList(openList?.row.setting === setting ? null : { camera: camera.camera, row })
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
        {readout(setting, label, levelText(level, setting === "tint"), null, false, () =>
          setTyped({ camera: camera.camera, row })
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

  /** A press-twice choice: the lit key is what the camera reports, the armed one what the next press sets. */
  const armedChoice = (
    setting: "resolution" | "frameRate" | "dynamicRange" | "displayLut",
    label: string,
    choice: CameraChoice,
    unit: string,
    className?: string
  ) => {
    const group = setting === "resolution" || setting === "frameRate" ? "format" : "look";
    return (
      <Segmented
        label={label}
        className={[styles.choices, className].filter(Boolean).join(" ")}
        testId={`cameras-${setting}`}
      >
        {choice.options.map((option) => {
          const key = `${group}:${number}:${setting}:${option}`;
          const unavailable = unavailableReason(choice, option);
          const reason = lock ?? (unavailable ? `${option}${unit}: ${unavailable}` : null);
          const current = shown && choice.value === option;
          return armed?.key === key ? (
            <ArmKey
              key={option}
              armed
              timeoutMs={armed.timeoutMs}
              countdownTestId={`cameras-${setting}-countdown`}
              armedWord="ARMED"
              className={styles.armedChoice}
              testId={`cameras-${setting}-${option}`}
              onClick={() =>
                group === "format"
                  ? onFormat(setting as "resolution" | "frameRate", option)
                  : onLook(setting as "dynamicRange" | "displayLut", option)
              }
            >
              {option}
            </ArmKey>
          ) : (
            <Key
              key={option}
              mode="segmented"
              engaged={current}
              aria-pressed={current}
              locked={reason !== null}
              reason={reason ?? undefined}
              testId={`cameras-${setting}-${option}`}
              onClick={() =>
                group === "format"
                  ? onFormat(setting as "resolution" | "frameRate", option)
                  : onLook(setting as "dynamicRange" | "displayLut", option)
              }
            >
              {option}
            </Key>
          );
        })}
      </Segmented>
    );
  };

  const choiceLabel = (label: string, choice: CameraChoice, unit: string, extra?: ReactNode) => (
    <div className={styles.choiceLabel}>
      <span>{label}</span>
      {extra}
      <span className={styles.choiceValue}>
        {shown && choice.value !== null ? `${choice.value}${unit}` : "not read"}
        {shown && choice.unavailable.length > 0
          ? ` · ${choice.unavailable.map((entry) => `${entry.value}${unit} ${entry.reason}`).join(", ")}`
          : ""}
      </span>
    </div>
  );

  const connection = () => {
    const last = clockTime(camera.readAt);
    switch (camera.state) {
      case "held":
        return {
          detail: linkLabel(camera),
          key: (
            <ArmKey
              armed={releaseArmed}
              timeoutMs={ARM_TIMEOUT_MS}
              countdownTestId="cameras-release-countdown"
              size="small"
              cap={releaseArmed ? "Release?" : undefined}
              testId="cameras-release"
              onClick={onRelease}
            >
              {releaseArmed ? undefined : `Release to ${releasedTo(camera)} · press twice`}
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

  const note = releaseArmed
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
  const lut = camera.values.displayLut;
  const lutOn = camera.values.displayLutOn;
  const range = camera.values.dynamicRange;

  return (
    <div className={styles.plate} data-testid="cameras-plate" data-camera={camera.camera}>
      <PlateHead
        title={camera.tag}
        sub={`${camera.model} · vMix Output ${camera.setup.vmixOutput}`}
        testId="cameras-plate-head"
      />

      <div className={styles.connectionBlock}>
        <div className={styles.connection} data-well="" data-testid="cameras-connection">
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
        title="Exposure"
        detail={sectionDetail(camera, "one press · press a value for the list")}
        testId="cameras-exposure"
      >
        {exposureRows(camera).map(choiceRow)}
        {once("iris", "Auto iris once")}
      </Section>

      <Section
        title="Colour"
        detail={sectionDetail(camera, "one press · press a value to type one")}
        testId="cameras-colour"
      >
        {colourRows(camera).map(levelRow)}
        {once("whiteBalance", "Auto white balance once")}
      </Section>

      <Section
        title="Focus"
        detail={sectionDetail(camera, focus.reported ? "one press · near 0, far 1" : "one press")}
        testId="cameras-focus"
      >
        {focus.reported ? (
          <FocusSlider doubt={doubt} level={focus} lock={lock} shown={shown} onSet={(value) => onSet("focus", value)} />
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
        title="Format"
        detail={sectionDetail(camera, "press twice · the picture drops while it changes")}
        testId="cameras-format"
      >
        {choiceLabel("Resolution", camera.values.resolution, "")}
        {armedChoice("resolution", "Resolution", camera.values.resolution, "")}
        {choiceLabel("Frame rate", camera.values.frameRate, "p")}
        {armedChoice("frameRate", "Frame rate", camera.values.frameRate, "p")}
      </Section>

      <Section
        title="Picture profile and LUT"
        detail={range.reported || lut.reported ? sectionDetail(camera, "press twice") : undefined}
        testId="cameras-look"
      >
        {range.reported ? (
          <>
            {choiceLabel("Dynamic range", range, "")}
            {armedChoice("dynamicRange", "Dynamic range", range, "")}
          </>
        ) : (
          notReported("dynamicRange", "Profile", range.notReported)
        )}
        {lut.reported ? (
          <>
            {choiceLabel(
              "Display LUT",
              lut,
              "",
              lutOn.reported ? (
                <Segmented label="Display LUT on or off" className={styles.onOff} testId="cameras-displayLutOn">
                  {[true, false].map((on) => {
                    const key = `look:${number}:displayLutOn:${String(on)}`;
                    const current = shown && lutOn.value === on;
                    return armed?.key === key ? (
                      <ArmKey
                        key={String(on)}
                        armed
                        timeoutMs={armed.timeoutMs}
                        countdownTestId="cameras-displayLutOn-countdown"
                        armedWord="ARMED"
                        size="small"
                        className={styles.armedChoice}
                        testId={`cameras-displayLutOn-${on ? "on" : "off"}`}
                        onClick={() => onLook("displayLutOn", on)}
                      >
                        {on ? "On" : "Off"}
                      </ArmKey>
                    ) : (
                      <Key
                        key={String(on)}
                        mode="segmented"
                        size="small"
                        engaged={current}
                        aria-pressed={current}
                        locked={!held}
                        reason={lock ?? undefined}
                        testId={`cameras-displayLutOn-${on ? "on" : "off"}`}
                        onClick={() => onLook("displayLutOn", on)}
                      >
                        {on ? "On" : "Off"}
                      </Key>
                    );
                  })}
                </Segmented>
              ) : null
            )}
            {armedChoice("displayLut", "Display LUT", lut, "", styles.lut)}
            {shown && lut.value === "Custom" ? (
              <p className={styles.fine}>{camera.tag} does not report a custom LUT's name.</p>
            ) : null}
          </>
        ) : (
          notReported("displayLut", "LUT", lut.notReported)
        )}
      </Section>

      <p className={[styles.fine, styles.foot].join(" ")} data-testid="cameras-plate-foot">
        {camera.recording.records
          ? "Recording, timecode and card time: under REC."
          : `${camera.tag} does not record here; REC acts on CAM 1.`}{" "}
        Not offered here: formatting a card, firmware, factory reset.
      </p>

      {openList ? (
        <CamerasValuesList
          camera={camera}
          row={openList.row}
          onClose={() => setList(null)}
          onPick={(value) => {
            setList(null);
            onSet(openList.row.setting, value);
          }}
        />
      ) : null}
      {openTyped ? (
        <NumberEntryDialog
          title={`Set ${openTyped.row.label.toLowerCase()} on ${camera.tag}`}
          fieldLabel={openTyped.row.label}
          initialValue={openTyped.row.level.value ?? openTyped.row.level.min}
          min={openTyped.row.level.min}
          max={openTyped.row.level.max}
          step={openTyped.row.level.step}
          suffix={openTyped.row.level.unit || undefined}
          onCancel={() => setTyped(null)}
          onConfirm={(value) => {
            setTyped(null);
            onSet(openTyped.row.setting, value);
          }}
        />
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
        <span>a position, not a distance</span>
        <span>far</span>
      </div>
    </>
  );
}
