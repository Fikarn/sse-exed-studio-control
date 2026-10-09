import {
  GroupedList,
  GroupedListRow,
  Key,
  LampWord,
  Latch,
  LatchSlot,
  MenuButton,
  Room,
  Section,
  StateDisplay,
  StatusCard,
  Tooltip,
  Tray,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";
import type {
  CameraSnapshot,
  JsonValue,
  PrompterGlassSummary,
  PrompterSnapshot,
  ShellStore,
  WorkspaceId,
} from "@sse/engine-client";

import type { AudioWorkspaceViewModel } from "../audio/audioViewModel";
import { batteryReadout, takeReadouts, type TakeReadout } from "../cameras/camerasModel";
import { RecKey } from "../cameras/RecKey";
import { takeKeysView } from "../teleprompter/teleprompterModel";
import type { OverviewLatch, OverviewState, StudioRow } from "./overviewModel";
import styles from "./OverviewCluster.module.css";

// The Overview's cluster (board 3's left column): the status card, where
// every page's state display stands (the worst page's word, its sentence and
// its way out, the page's ⋯, every page's latches under a hairline); THE
// TAKE, everything pressed during a take, REC and the prompter's transport
// in the order of their own pages; and outside the rooms, the studio, what
// each page has set, one row each.

export interface OverviewClusterProps {
  arm: UseArmResult;
  /** What the armed row says before "· press again". */
  armedWords: string | null;
  audio: AudioWorkspaceViewModel | null;
  glass: PrompterGlassSummary | null;
  /** Where BACK goes (`backParagraph`). */
  backTo: number;
  latches: readonly OverviewLatch[];
  /** CAM 1, whose take REC starts and stops. */
  main: CameraSnapshot | null;
  /** The clock the take's length is counted against. */
  now: number;
  prompterSnapshot: PrompterSnapshot | null;
  rows: readonly StudioRow[];
  state: OverviewState;
  stopArmed: boolean;
  store: ShellStore;
  onClearAudioSolo: () => void;
  onClearClips: () => void;
  onClearLightingOverlay: () => void;
  onOpen: (page: WorkspaceId) => void;
  onReadAgain: () => void;
  onRecord: () => void;
  onSpeed: (step: number) => void;
  onSync: () => void;
  /** A take key of the prompter, sent as the Teleprompter page sends it. */
  onTake: (action: () => Promise<JsonValue>) => void;
}

/** A take row: the value, and what it is in a few words; the whole sentence on hover. */
function takeRow(row: TakeReadout) {
  const note = row.note ? (
    row.explain ? (
      <Tooltip content={row.explain} placement="right">
        <span>{row.note}</span>
      </Tooltip>
    ) : (
      row.note
    )
  ) : undefined;
  return (
    <GroupedListRow
      key={row.id}
      label={row.label}
      value={row.value ?? undefined}
      note={note}
      doubt={row.doubt}
      testId={`overview-take-${row.id}`}
    />
  );
}

export function OverviewCluster({
  arm,
  armedWords,
  audio,
  glass,
  backTo,
  latches,
  main,
  now,
  prompterSnapshot,
  rows,
  state,
  stopArmed,
  store,
  onClearAudioSolo,
  onClearClips,
  onClearLightingOverlay,
  onOpen,
  onReadAgain,
  onRecord,
  onSpeed,
  onSync,
  onTake,
}: OverviewClusterProps) {
  const keys = prompterSnapshot ? takeKeysView(prompterSnapshot, backTo) : null;
  const locked = (lock: string | null | undefined) => ({ locked: lock !== null, reason: lock ?? undefined });
  const noPrompter = "Reading the prompter's state…";

  // The page's ⋯ (overview-2.md §9): the standing commands of the pages it
  // shows, with their own words and their own reasons for refusing.
  const clipsHeld = (audio?.clippedChannels.length ?? 0) > 0;
  const pageMenu: MenuEntry[] = [
    {
      id: "sync",
      label: "Sync from TotalMix",
      onSelect: onSync,
      disabledReason: !audio
        ? "the Console is not read yet"
        : audio.capabilities.canSync
          ? null
          : "TotalMix cannot be read now",
      testId: "overview-menu-sync",
    },
    { id: "read-all", label: "Read all cameras again", onSelect: onReadAgain, testId: "overview-menu-read-all" },
    {
      id: "clear-clips",
      label: "Clear clips",
      onSelect: onClearClips,
      disabledReason: !audio?.capabilities.canClearClips ? "OSC control is off" : clipsHeld ? null : "no clip held",
      testId: "overview-menu-clear-clips",
    },
    { kind: "divider", id: "setup-divider" },
    { id: "setup", label: "Setup / Support", onSelect: () => onOpen("setup"), testId: "overview-menu-setup" },
  ];

  const wayOut = state.wayOut;
  const take = [...takeReadouts(main, now), batteryReadout(main)];

  return (
    <div className={styles.cluster} data-testid="overview-cluster">
      <StatusCard error={state.tone === "error"} latched={latches.length > 0} testId="overview-status-card">
        <StateDisplay
          tone={state.tone}
          word={state.word}
          sentence={state.sentence}
          meta={state.meta ?? undefined}
          data-lamp={state.lamp ?? undefined}
          actions={
            wayOut ? (
              <Key
                size="small"
                mode="primary"
                testId={wayOut.kind === "sync" ? "overview-state-sync" : `overview-state-open-${wayOut.page}`}
                onClick={wayOut.kind === "sync" ? onSync : () => onOpen(wayOut.page)}
              >
                {wayOut.label}
              </Key>
            ) : undefined
          }
          // REC's stop is the one key here that arms; the row says what the second press does.
          armed={
            arm.armed
              ? {
                  text: `${armedWords ?? arm.armed.label} · press again`,
                  timeoutMs: arm.armed.timeoutMs,
                  armedAt: arm.armed.armedAt,
                }
              : null
          }
          testId="overview-state-display"
          menu={
            <MenuButton
              buttonLabel="Overview menu"
              buttonTestId="overview-page-menu"
              menu={{ head: { title: "Overview" }, items: pageMenu }}
            />
          }
        />
        <LatchSlot testId="overview-latch-slot">
          {latches.map((latch) => (
            <Latch
              key={latch.id}
              who={latch.who}
              testId={`overview-latch-${latch.id}`}
              action={
                <Key
                  size="small"
                  testId={`overview-latch-${latch.id}-clear`}
                  aria-label={latch.clear.ariaLabel}
                  locked={latch.clear.locked}
                  reason={latch.clear.reason || undefined}
                  onClick={
                    latch.id === "audio-clip"
                      ? onClearClips
                      : latch.id === "audio-solo"
                        ? onClearAudioSolo
                        : onClearLightingOverlay
                  }
                >
                  {latch.clear.label}
                </Key>
              }
            >
              {latch.text}
            </Latch>
          ))}
        </LatchSlot>
      </StatusCard>

      <Room tone="stone" name="The take" job="act" className={styles.take} testId="overview-room-take">
        <div className={styles.takeBody}>
          <RecKey
            main={main}
            stopArmed={stopArmed}
            onRecord={onRecord}
            testId="overview-rec"
            countdownTestId="overview-stop-countdown"
            className={styles.rec}
          />
          <GroupedList testId="overview-take">{take.map(takeRow)}</GroupedList>
          <Tray className={styles.transport} testId="overview-transport">
            <Key
              cap="Play"
              hint={keys?.play.hint}
              layout="stack"
              size="tall"
              live={keys?.play.live ?? false}
              aria-pressed={keys?.play.live ?? false}
              {...locked(keys ? keys.play.lock : noPrompter)}
              take
              className={styles.play}
              testId="overview-play"
              onClick={() => onTake(() => (glass?.playing ? store.pausePrompter() : store.playPrompter()))}
            />
            <Key
              cap="Back"
              hint={keys?.back.hint}
              layout="stack"
              {...locked(keys ? keys.back.lock : noPrompter)}
              take
              testId="overview-back"
              onClick={() => onTake(() => store.jumpPrompter({ to: "back" }))}
            />
            <Key
              cap="Top"
              hint={keys?.top.hint}
              layout="stack"
              {...locked(keys ? keys.top.lock : noPrompter)}
              take
              testId="overview-top"
              onClick={() => onTake(() => store.jumpPrompter({ to: "top" }))}
            />
          </Tray>
          <Tray className={styles.steps} testId="overview-steps">
            <Key
              size="large"
              {...locked(keys ? keys.slower.lock : noPrompter)}
              take
              testId="overview-speed-down"
              aria-label="Slower by 5 words a minute"
              onClick={() => onSpeed(-1)}
            >
              − 5
            </Key>
            <Key
              size="large"
              {...locked(keys ? keys.faster.lock : noPrompter)}
              take
              testId="overview-speed-up"
              aria-label="Faster by 5 words a minute"
              onClick={() => onSpeed(1)}
            >
              + 5
            </Key>
            <Key
              size="large"
              {...locked(keys ? keys.previousCue.lock : noPrompter)}
              take
              testId="overview-cue-back"
              onClick={() => onTake(() => store.jumpPrompter({ to: "previousCue" }))}
            >
              ◂ Cue
            </Key>
            <Key
              size="large"
              {...locked(keys ? keys.nextCue.lock : noPrompter)}
              take
              testId="overview-cue-on"
              onClick={() => onTake(() => store.jumpPrompter({ to: "nextCue" }))}
            >
              Cue ▸
            </Key>
          </Tray>
        </div>
      </Room>

      <Section title="The studio" detail="what each page has set" className={styles.studio} testId="overview-studio">
        <GroupedList tall>
          {rows.map((row) => (
            <GroupedListRow key={row.id} testId={`overview-studio-${row.id}`}>
              <span className={styles.studioLabel}>{row.label}</span>
              {/* A long scene name gives way, whole on hover. */}
              <span
                className={styles.studioValue}
                data-row-value=""
                data-doubt={row.doubt ? "" : undefined}
                data-cut-by-design=""
                title={row.value}
              >
                {row.value}
              </span>
              <LampWord tone={row.tone} className={styles.studioWord}>
                {row.word}
              </LampWord>
            </GroupedListRow>
          ))}
        </GroupedList>
      </Section>
    </div>
  );
}
