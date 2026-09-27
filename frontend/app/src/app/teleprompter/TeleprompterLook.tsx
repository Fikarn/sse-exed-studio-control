import { useState } from "react";

import { ControlRow, Key, Section, Segmented, Slider } from "@sse/design-system";
import type { PrompterLookUpdateRequest, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import type { PerformAction } from "./TeleprompterWorkspace";
import styles from "./TeleprompterPlate.module.css";

// The look (new pages program, Slice 6a; the proposal §4.1, board 1's plate):
// one look for the glass, applied at once with one press or a release of a
// slider, the words at the reading line kept where they are. The ranges are
// the hardware link's (`look.rs`); a slider moves freely under the hand and
// sends its value when it is let go.

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

interface LookSliderProps {
  label: string;
  detail: string;
  value: number;
  range: Range;
  format: (value: number) => string;
  testId: string;
  onCommit: (value: number) => void;
}

function LookSlider({ label, detail, value, range, format, testId, onCommit }: LookSliderProps) {
  // The value under the hand while it moves; the look's own once let go.
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? value;
  return (
    <ControlRow label={label} detail={detail} value={format(shown)} testId={testId}>
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

export interface TeleprompterLookProps {
  snapshot: PrompterSnapshot;
  store: ShellStore;
  perform: PerformAction;
}

export function TeleprompterLook({ snapshot, store, perform }: TeleprompterLookProps) {
  const { look, sizePx } = snapshot;
  const update = (request: PrompterLookUpdateRequest) => void perform(() => store.updatePrompterLook(request));
  const atStandard = sizePx === look.standardSizePx;
  const toggle = (label: string, engaged: boolean, testId: string, request: PrompterLookUpdateRequest) => (
    <div className={styles.toggleRow}>
      <span className={styles.toggleLabel}>{label}</span>
      <Key mode="toggle" size="small" engaged={engaged} testId={testId} onClick={() => update(request)}>
        {engaged ? "On" : "Off"}
      </Key>
    </div>
  );

  return (
    <Section title="The look" detail="one look for the glass · applies at once" testId="teleprompter-look">
      <div className={styles.sizeRow}>
        <output className={styles.sizeReadout} data-testid="teleprompter-text-size">
          <b>{sizePx} px</b> {atStandard ? "standard" : `standard ${look.standardSizePx}`}
        </output>
        <Key
          size="small"
          testId="teleprompter-size-down"
          aria-label="Smaller by 4 px"
          onClick={() => void perform(() => store.setPrompterTextSize({ step: -4 }))}
        >
          − 4
        </Key>
        <Key
          size="small"
          testId="teleprompter-size-up"
          aria-label="Larger by 4 px"
          onClick={() => void perform(() => store.setPrompterTextSize({ step: 4 }))}
        >
          + 4
        </Key>
        <Key
          size="small"
          testId="teleprompter-size-standard"
          locked={atStandard}
          reason="The text is at the standard size."
          onClick={() => void perform(() => store.setPrompterTextSize({ standard: true }))}
        >
          Standard
        </Key>
      </div>
      <LookSlider
        label="Line spacing"
        detail="1.1–2.0"
        value={look.lineSpacingPercent}
        range={LINE_SPACING}
        format={(value) => (value / 100).toFixed(1)}
        testId="teleprompter-line-spacing"
        onCommit={(value) => update({ lineSpacingPercent: value })}
      />
      <LookSlider
        label="Margins"
        detail="each side · 0–30 %"
        value={look.marginPercent}
        range={MARGINS}
        format={(value) => `${value} %`}
        testId="teleprompter-margins"
        onCommit={(value) => update({ marginPercent: value })}
      />
      <LookSlider
        label="Reading line"
        detail="from the top · 20–60 %"
        value={look.readingLinePercent}
        range={READING_LINE}
        format={(value) => `${value} %`}
        testId="teleprompter-reading-line"
        onCommit={(value) => update({ readingLinePercent: value })}
      />
      <div className={styles.toggleRow}>
        <span className={styles.toggleLabel}>Text colour · on black, always</span>
        <Segmented label="Text colour" testId="teleprompter-text-colour">
          <Key
            mode="segmented"
            size="small"
            engaged={look.textColour === "white"}
            testId="teleprompter-colour-white"
            onClick={() => update({ textColour: "white" })}
          >
            White
          </Key>
          <Key
            mode="segmented"
            size="small"
            engaged={look.textColour === "yellow"}
            testId="teleprompter-colour-yellow"
            onClick={() => update({ textColour: "yellow" })}
          >
            Yellow
          </Key>
        </Segmented>
      </div>
      {toggle("Dim text already read", look.dimReadText, "teleprompter-dim-read", {
        dimReadText: !look.dimReadText,
      })}
      {toggle("A line across at the reading line", look.readingLineAcross, "teleprompter-line-across", {
        readingLineAcross: !look.readingLineAcross,
      })}
      {toggle("Paragraph numbers on the glass", look.paragraphNumbers, "teleprompter-paragraph-numbers", {
        paragraphNumbers: !look.paragraphNumbers,
      })}
    </Section>
  );
}
