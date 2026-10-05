import { useRef, useState } from "react";

import { ControlRow, Key, Popover, Readouts, Section, Segmented, Slider, Tooltip } from "@sse/design-system";
import type { PrompterLook, PrompterLookUpdateRequest, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import { TAKE, type PerformAction } from "./perform";
import styles from "./TeleprompterLook.module.css";

// The look (new pages program, Slice 6a; the proposal §4.1): one look for the
// glass, applied at once with one press or a release of a slider, the words
// at the reading line kept where they are. The ranges are the hardware link's
// (`look.rs`); a slider moves freely under the hand and sends its value when
// it is let go.
//
// The visual overhaul (2026-10-05): the plate shows the look's values, and
// Change… opens them in a popover beside the section, never a dialog: the
// three sliders, the text colour and the three toggles. The current colour and
// each toggle's state are the Beige selection, not a yellow fill. Nothing in
// it arms. The text size is a take-time key and stands in the cluster.

interface Range {
  min: number;
  max: number;
  step: number;
}

const LINE_SPACING: Range = { min: 110, max: 200, step: 10 };
const MARGINS: Range = { min: 0, max: 30, step: 1 };
const READING_LINE: Range = { min: 20, max: 60, step: 1 };

const toShare = (value: number, range: Range) => (value - range.min) / (range.max - range.min);
const fromShare = (share: number, range: Range) =>
  Math.round((range.min + share * (range.max - range.min)) / range.step) * range.step;

const spacing = (value: number) => (value / 100).toFixed(1);
const percent = (value: number) => `${value} %`;
const onOff = (on: boolean) => (on ? "on" : "off");

interface LookSliderProps {
  label: string;
  tip: string;
  value: number;
  range: Range;
  format: (value: number) => string;
  testId: string;
  onCommit: (value: number) => void;
}

function LookSlider({ label, tip, value, range, format, testId, onCommit }: LookSliderProps) {
  // The value under the hand while it moves; the look's own once let go. The
  // page reads the prompter once a second while it plays: this is kept across
  // those renders, so a hand on the slider is never overruled.
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? value;
  return (
    <ControlRow
      label={
        <Tooltip content={tip} placement="left">
          <span>{label}</span>
        </Tooltip>
      }
      value={format(shown)}
      testId={testId}
    >
      <Slider
        label={label}
        value={toShare(shown, range)}
        step={range.step / (range.max - range.min)}
        valueText={format(shown)}
        onChange={(share) => setMoving(fromShare(share, range))}
        onCommit={(share) => {
          const next = fromShare(share, range);
          setMoving(null);
          if (next !== value) onCommit(next);
        }}
      />
    </ControlRow>
  );
}

interface ChoiceProps<T extends string | boolean> {
  label: string;
  options: readonly { value: T; word: string; testId: string }[];
  current: T;
  testId: string;
  onChoose: (value: T) => void;
}

/** A row of the popover: its words, and the choices with the current one as the selection. */
function Choice<T extends string | boolean>({ label, options, current, testId, onChoose }: ChoiceProps<T>) {
  return (
    <div className={styles.choiceRow}>
      <span className={styles.choiceLabel}>{label}</span>
      <Segmented label={label} className={styles.choices} testId={testId}>
        {options.map((option) => (
          <Key
            key={option.word}
            mode="segmented"
            size="small"
            selected={current === option.value}
            aria-pressed={current === option.value}
            testId={option.testId}
            onClick={() => {
              if (current !== option.value) onChoose(option.value);
            }}
          >
            {option.word}
          </Key>
        ))}
      </Segmented>
    </div>
  );
}

/** An on/off setting of the look, as two choices. */
function toggle(label: string, value: boolean, testId: string, onChoose: (on: boolean) => void) {
  return (
    <Choice
      label={label}
      current={value}
      testId={testId}
      options={[
        { value: true, word: "On", testId: `${testId}-on` },
        { value: false, word: "Off", testId: `${testId}-off` },
      ]}
      onChoose={onChoose}
    />
  );
}

/** The look's values, as the plate prints them. */
function lookRows(look: PrompterLook) {
  return [
    { id: "spacing", label: "Line spacing", value: spacing(look.lineSpacingPercent) },
    { id: "margins", label: "Margins, each side", value: percent(look.marginPercent) },
    { id: "reading-line", label: "Reading line, from the top", value: percent(look.readingLinePercent) },
    { id: "colour", label: "Text colour", value: look.textColour === "yellow" ? "Yellow" : "White" },
    { id: "dim", label: "Dim text already read", value: onOff(look.dimReadText) },
    { id: "across", label: "A line across at the reading line", value: onOff(look.readingLineAcross) },
    { id: "numbers", label: "Paragraph numbers on the glass", value: onOff(look.paragraphNumbers) },
  ];
}

export interface TeleprompterLookProps {
  snapshot: PrompterSnapshot;
  store: ShellStore;
  perform: PerformAction;
}

export function TeleprompterLook({ snapshot, store, perform }: TeleprompterLookProps) {
  const { look } = snapshot;
  const [open, setOpen] = useState(false);
  // The section the popover stands beside (Section takes no ref: a wrapper).
  const section = useRef<HTMLDivElement | null>(null);
  // The key that opened the popover: a press on it closes it again, and the
  // focus comes back to it; a press anywhere else closes it too.
  const opener = useRef<HTMLSpanElement | null>(null);
  const update = (request: PrompterLookUpdateRequest) =>
    void perform(() => store.updatePrompterLook(request), false, TAKE);

  return (
    <div ref={section} className={styles.section}>
      <Section
        title={
          <Tooltip
            content="One look for the glass. A change applies at once, and the words at the reading line stay where they are."
            placement="left"
          >
            <span>The look</span>
          </Tooltip>
        }
        actions={
          <span ref={opener} className={styles.opener}>
            <Key
              size="small"
              aria-expanded={open}
              testId="teleprompter-look-open"
              onClick={() => setOpen((was) => !was)}
            >
              Change…
            </Key>
          </span>
        }
        testId="teleprompter-look"
      >
        <Readouts rows={lookRows(look)} data-testid="teleprompter-look-values" />
        <Popover
          open={open}
          anchor={section.current}
          onClose={() => setOpen(false)}
          title="The look"
          placement="left-start"
          width={407}
          ignoreOutside={[opener]}
          returnFocusTo={opener.current?.querySelector("button") ?? null}
          initialFocus="first"
          testId="teleprompter-look-popover"
        >
          <div className={styles.body}>
            <LookSlider
              label="Line spacing"
              tip="From 1.1 to 2.0 times the text size."
              value={look.lineSpacingPercent}
              range={LINE_SPACING}
              format={spacing}
              testId="teleprompter-line-spacing"
              onCommit={(value) => update({ lineSpacingPercent: value })}
            />
            <LookSlider
              label="Margins"
              tip="Each side, from 0 to 30 % of the glass."
              value={look.marginPercent}
              range={MARGINS}
              format={percent}
              testId="teleprompter-margins"
              onCommit={(value) => update({ marginPercent: value })}
            />
            <LookSlider
              label="Reading line"
              tip="From the top, from 20 to 60 % of the glass."
              value={look.readingLinePercent}
              range={READING_LINE}
              format={percent}
              testId="teleprompter-reading-line"
              onCommit={(value) => update({ readingLinePercent: value })}
            />
            <Choice<"white" | "yellow">
              label="Text colour, on black"
              current={look.textColour === "yellow" ? "yellow" : "white"}
              testId="teleprompter-text-colour"
              options={[
                { value: "white", word: "White", testId: "teleprompter-colour-white" },
                { value: "yellow", word: "Yellow", testId: "teleprompter-colour-yellow" },
              ]}
              onChoose={(textColour) => update({ textColour })}
            />
            {toggle("Dim text already read", look.dimReadText, "teleprompter-dim-read", (dimReadText) =>
              update({ dimReadText })
            )}
            {toggle("A line across at the reading line", look.readingLineAcross, "teleprompter-line-across", (on) =>
              update({ readingLineAcross: on })
            )}
            {toggle("Paragraph numbers on the glass", look.paragraphNumbers, "teleprompter-paragraph-numbers", (on) =>
              update({ paragraphNumbers: on })
            )}
          </div>
        </Popover>
      </Section>
    </div>
  );
}
