import { Door, EmptyLine, GroupedList, GroupedListRow, LampWord, Room, SpeedTape, Tray } from "@sse/design-system";
import type { PrompterSnapshot } from "@sse/engine-client";

import type { GlassParagraph } from "../teleprompter/glass/glassText";
import {
  PrompterGlass,
  type PrompterGlassLayoutReport,
  type PrompterGlassText,
} from "../teleprompter/glass/PrompterGlass";
import {
  barStart,
  placeView,
  runStateWord,
  scriptBar,
  SPEED_RANGE,
  SPEED_STEP,
  timeLeftParts,
} from "../teleprompter/teleprompterModel";
import { cuesAhead, glassBand, placeParts, type OverviewAlert } from "./overviewModel";
import type { SpeedTapeView } from "./useSpeedTape";
import styles from "./OverviewScript.module.css";

// THE SCRIPT (read, slate): the speed as a tape that moves one tick a detent
// of the deck's SPEED dial (overview-2.md §3), the glass where the
// presenter's eyes are, and what comes next: the place, the time left and the
// cues ahead with the time until each at this speed. Turn the knob and these
// follow. The whole script lies along the floor, read only: no press here
// jumps the script (the board's note 10).

/** The glass band: a crop of the glass's own copy (the board's note 9). */
const BAND = { width: 880, height: 332 } as const;
/** Past this many paragraphs the floor's tray draws what was read and what is left, as the Teleprompter's bar does. */
const TRAY_SEGMENT_ROOM = 115;

export interface OverviewScriptProps {
  alert: OverviewAlert | null;
  /** The glass's text, cut into paragraphs (`cutGlassText`). */
  cut: readonly GlassParagraph[];
  /** The seconds since the prompter's last report, while it scrolls (`usePrompterElapsed`). */
  elapsed: number;
  glassText: PrompterGlassText | null;
  /** The page's clock, for the time the script ends. */
  now: number;
  snapshot: PrompterSnapshot | null;
  tape: SpeedTapeView;
  /** The time left now (`usePrompterTimeLeft`). */
  timeLeft: number | null;
  onLayout: (report: PrompterGlassLayoutReport) => void;
  onOpen: () => void;
}

export function OverviewScript({
  alert,
  cut,
  elapsed,
  glassText,
  now,
  snapshot,
  tape,
  timeLeft,
  onLayout,
  onOpen,
}: OverviewScriptProps) {
  const glass = snapshot?.glass ?? null;
  const draws = snapshot?.screen.draws ?? false;
  const band = glassText ? glassBand(glassText, BAND) : null;
  const place = glass ? placeView(glass, cut) : null;
  const parts = glass && place ? placeParts(glass, place.share) : null;
  const left = glass && timeLeft !== null ? timeLeftParts(glass, timeLeft, new Date(now)) : null;
  const ahead = glass ? cuesAhead(glass, elapsed) : [];
  const segments = scriptBar(cut);
  const readUpTo = glass ? (glass.atEnd ? glass.paragraphCount : glass.place.paragraph) : 0;
  const dense = segments.length > TRAY_SEGMENT_ROOM;

  const facts = glass ? (
    <>
      <span className={styles.factName} data-cut-by-design="" title={glass.name}>
        {glass.name}
      </span>
      <LampWord tone={glass.playing ? "ok" : "off"} testId="overview-run-state">
        {runStateWord(glass)}
      </LampWord>
    </>
  ) : (
    <span>Nothing on the prompter</span>
  );

  const floor = glass ? (
    <Tray className={styles.script} testId="overview-script-tray">
      <span className={styles.track} role="img" aria-label={`The whole script: ${place?.text ?? ""}`}>
        {dense ? (
          <>
            <span
              className={styles.segment}
              data-read=""
              style={{ left: 0, width: `${barStart(segments, readUpTo) * 100}%` }}
            />
            <span
              className={styles.segment}
              style={{
                left: `${barStart(segments, readUpTo) * 100}%`,
                width: `${(1 - barStart(segments, readUpTo)) * 100}%`,
              }}
            />
          </>
        ) : (
          segments.map((segment) => (
            <span
              key={segment.index}
              className={styles.segment}
              data-read={segment.index < readUpTo ? "" : undefined}
              style={{ left: `${segment.start * 100}%`, width: `calc(${segment.share * 100}% - 2px)` }}
            >
              {segments.length <= 40 ? <span className={styles.segmentNumber}>{segment.index + 1}</span> : null}
            </span>
          ))
        )}
        {glass.cues.map((cue, index) => (
          <i
            key={`${cue.paragraph}:${cue.word}:${index}`}
            className={styles.cueTick}
            style={{ left: `${barStart(segments, cue.paragraph) * 100}%` }}
          />
        ))}
        {place ? (
          <i
            className={styles.placeMark}
            data-testid="overview-script-place"
            style={{ left: `${place.share * 100}%` }}
          />
        ) : null}
      </span>
    </Tray>
  ) : null;

  return (
    <Room
      tone="slate"
      name="The script"
      job="read"
      facts={facts}
      alert={alert}
      floor={60}
      floorContent={floor}
      className={styles.room}
      testId="overview-room-script"
      actions={<Door page="Teleprompter" testId="overview-door-teleprompter" onClick={onOpen} />}
    >
      <div className={styles.body}>
        <div className={styles.speed}>
          {glass ? (
            <SpeedTape
              value={glass.speedWpm}
              min={SPEED_RANGE.min}
              max={SPEED_RANGE.max}
              step={SPEED_STEP}
              range={tape.range}
              turned={tape.turned}
              caption={tape.caption}
              testId="overview-speed-tape"
            />
          ) : (
            <div className={styles.speedEmpty} data-well="">
              <EmptyLine>No speed: nothing on the prompter</EmptyLine>
            </div>
          )}
        </div>

        <div
          className={styles.band}
          data-on-glass={draws ? "" : undefined}
          data-playing={glass?.playing ? "" : undefined}
          data-testid="overview-glass-band"
          data-reading-line={band ? band.readingLine : undefined}
        >
          {glassText && band ? (
            <div className={styles.glassAt} style={{ left: band.left, top: band.top }}>
              <PrompterGlass
                text={glassText}
                anchor={glass?.anchor ?? null}
                width={band.width}
                onLayout={onLayout}
                label={glass ? `The prompter's glass: ${glass.name}` : "The prompter's glass: nothing on it"}
                testId="overview-glass"
              />
            </div>
          ) : (
            <EmptyLine>Nothing on the prompter.</EmptyLine>
          )}
          {!draws && glass ? (
            <span className={styles.notOnGlass}>
              <LampWord tone="error" testId="overview-not-on-glass">
                Not on the glass
              </LampWord>
            </span>
          ) : null}
        </div>

        <div className={styles.side}>
          <div className={styles.cells}>
            <div className={styles.cell} data-well="" data-testid="overview-place">
              <span className={styles.kick}>Place</span>
              <span className={styles.cellValue}>
                <span>{parts?.paragraph ?? "—"}</span>
                {parts ? <span className={styles.cellNote}>{parts.share}</span> : null}
              </span>
            </div>
            <div className={styles.cell} data-well="" data-testid="overview-left">
              <span className={styles.kick}>Left</span>
              <span className={styles.cellValue}>
                <span>{left?.left ?? "—"}</span>
                {left?.ends ? <span className={styles.cellNote}>{left.ends}</span> : null}
              </span>
            </div>
          </div>

          <div className={styles.cuesHead}>
            <span className={styles.cuesTitle}>Cues ahead</span>
            {glass ? <span className={styles.cuesAt}>at {glass.speedWpm} words/min</span> : null}
          </div>
          <GroupedList tall testId="overview-cues">
            {ahead.length > 0 ? (
              ahead.map((cue, index) => (
                <GroupedListRow key={`${cue.paragraph}:${index}`} testId={`overview-cue-${index}`}>
                  <span
                    className={styles.cueTime}
                    data-seconds={cue.seconds === null ? undefined : cue.seconds.toFixed(1)}
                  >
                    {cue.time}
                  </span>
                  <span className={styles.cueText} data-cut-by-design="" title={cue.text}>
                    {cue.text}
                  </span>
                  <span className={styles.cueParagraph}>¶ {cue.paragraph + 1}</span>
                </GroupedListRow>
              ))
            ) : (
              <GroupedListRow testId="overview-cue-none">
                <span className={styles.cueTime}>—</span>
                <span className={styles.cueNone}>{glass ? "No cue ahead" : "Nothing on the prompter"}</span>
              </GroupedListRow>
            )}
          </GroupedList>
        </div>
      </div>
    </Room>
  );
}
