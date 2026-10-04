import { useRef, useState, type CSSProperties } from "react";
import {
  Key,
  MenuButton,
  Popover,
  Section,
  Segmented,
  Tooltip,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { AudioKnob } from "../AudioKnob";
import type { useAudioInspectorEqState } from "../../hooks/useAudioInspectorEqState";
import {
  EQ_FREQUENCY_MARKERS,
  EQ_FREQUENCY_MAX,
  EQ_FREQUENCY_MIN,
  EQ_GAIN_MARKERS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_Q_MAX,
  EQ_Q_MIN,
  eqBandId,
  eqBandType,
  eqBandTypeOptionsFor,
  eqPointX,
  eqPointY,
  formatEqBandType,
  formatEqFrequency,
  LOW_CUT_FREQUENCY_MAX,
  LOW_CUT_FREQUENCY_MIN,
  LOW_CUT_HANDLE_ID,
  LOW_CUT_SLOPES,
  type AudioEqBand,
  type AudioEqUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";
import type { PlateValueEntry } from "./usePlateValueEntry";

// The plate's equaliser (visual overhaul, the Console; Atrium): the response
// graph with its points, which a drag moves, and the band table under it, the
// one place every band's values are read. A band's key (or a press on its
// point) opens the band's popover beside the table: its type, its knobs, and
// for the Low Cut its slope. Switching the equaliser and the Low Cut is in the
// section's ⋯ and the band's popover.

type EqState = ReturnType<typeof useAudioInspectorEqState>;

function formatEqGain(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

/** A press on a point that did not move it opens the band; a drag does not. */
const CLICK_SLOP_PX = 4;

export function AudioPlateEq({
  arm,
  ask,
  canEdit,
  channel,
  clearDraftValueLater,
  eqState,
  menuLock,
  onUpdateChannelEq,
  setDraftValue,
}: {
  arm: UseArmResult;
  ask: (entry: PlateValueEntry) => void;
  canEdit: boolean;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  eqState: EqState;
  menuLock: string | null;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
}) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const [openBand, setOpenBand] = useState<string | null>(null);
  const {
    activeEqHandleId,
    commitEqPointFromPointer,
    commitLowCutFromPointer,
    eqBands,
    eqDragRef,
    eqGraphPath,
    lowCutFrequencyKey,
    lowCutFrequencyValue,
    lowCutShade,
    setSelectedEqBandId,
  } = eqState;
  const eq = channel.eq;
  const lowCut = eq.lowCut;
  const lock = menuLock ?? (canEdit ? null : "TotalMix FX cannot be changed now");

  const openBandPopover = (id: string) => {
    setSelectedEqBandId(id);
    setOpenBand(id);
  };
  const pressedWithoutMoving = (event: { clientX: number; clientY: number }) => {
    const start = pressRef.current;
    pressRef.current = null;
    return !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < CLICK_SLOP_PX;
  };

  const menuItems: MenuEntry[] = [
    {
      kind: "check",
      id: "peq",
      label: "Equaliser",
      checked: eq.enabled,
      offWord: "bypassed",
      onCheckedChange: (enabled) => onUpdateChannelEq({ channelId: channel.id, enabled }),
      disabledReason: lock,
      testId: "audio-eq-menu-peq",
    },
    {
      kind: "check",
      id: "low-cut",
      label: "Low Cut",
      checked: lowCut.enabled,
      onCheckedChange: (lowCutEnabled) => onUpdateChannelEq({ channelId: channel.id, lowCutEnabled }),
      disabledReason: lock,
      testId: "audio-eq-menu-low-cut",
    },
    { kind: "label", id: "slope", label: "Low Cut slope" },
    ...LOW_CUT_SLOPES.map(
      (slope) =>
        ({
          kind: "radio",
          id: `slope-${slope}`,
          label: `${slope} dB/oct`,
          checked: lowCut.slopeDbPerOctave === slope,
          onSelect: () => onUpdateChannelEq({ channelId: channel.id, lowCutSlopeDbPerOctave: slope }),
          disabledReason: lock,
        }) satisfies MenuEntry
    ),
  ];

  const columns: Array<{ id: string; key: string; band: AudioEqBand | null }> = [
    { id: LOW_CUT_HANDLE_ID, key: "LC", band: null },
    ...eqBands.map((band) => ({ id: band.id, key: band.label, band })),
  ];
  const openColumn = columns.find((column) => column.id === openBand) ?? null;

  return (
    <Section
      title={
        <Tooltip content="TotalMix FX's equaliser: a Low Cut and three bands" placement="left">
          <span>Equaliser</span>
        </Tooltip>
      }
      detail={eq.enabled ? "on" : "bypassed"}
      actions={
        <MenuButton
          buttonLabel="Equaliser menu"
          buttonTestId="audio-eq-menu"
          size="sm"
          menu={{ head: { title: "Equaliser", detail: channel.name }, items: menuItems, arm }}
        />
      }
      className={styles.section}
      data-plate-section="eq"
      testId="audio-inspector-eq"
    >
      <div className={styles.eqGraph} data-eq-graph="true" data-eq-enabled={eq.enabled} data-testid="audio-eq-graph">
        <div className={styles.eqGuides} aria-hidden="true">
          <div className={styles.eqDbMarkers} data-testid="audio-eq-db-scale">
            {EQ_GAIN_MARKERS.map((marker) => (
              <span
                className={styles.eqDbLabel}
                key={marker.label}
                style={{ "--eq-marker-y": `${eqPointY(marker.gainDb)}%` } as CSSProperties}
              >
                {marker.label}
              </span>
            ))}
          </div>
          <div className={styles.eqFrequencyMarkers} data-testid="audio-eq-frequency-markers">
            {EQ_FREQUENCY_MARKERS.map((marker) => (
              <span
                className={styles.eqFrequencyMarker}
                data-major={marker.major}
                key={marker.frequencyHz}
                style={{ "--eq-marker-x": `${eqPointX(marker.frequencyHz)}%` } as CSSProperties}
              >
                <i />
                {/* The decades are named (100, 1 k, 10 k); the ends are the
                    graph's edges and the dB marks stand in their corners. */}
                {[100, 1000, 10000].includes(marker.frequencyHz) ? <small>{marker.label}</small> : null}
              </span>
            ))}
          </div>
        </div>
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {lowCutShade ? (
            <path className={styles.eqLowCutShade} d={lowCutShade} data-testid="audio-eq-low-cut-shade" />
          ) : null}
          <path className={styles.eqCurve} d={eqGraphPath} />
        </svg>
        <div className={styles.eqPoints}>
          <button
            aria-label={`${channel.name} Low Cut EQ point`}
            className={`${styles.eqPoint} ${styles.eqLowCutPoint}`}
            data-active={lowCut.enabled}
            data-lit={activeEqHandleId === LOW_CUT_HANDLE_ID ? "" : undefined}
            data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
            data-testid="audio-eq-point-low-cut"
            disabled={!canEdit}
            onClick={(event) => {
              if (pressedWithoutMoving(event)) openBandPopover(LOW_CUT_HANDLE_ID);
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              pressRef.current = { x: event.clientX, y: event.clientY };
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              commitLowCutFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.preventDefault();
              event.stopPropagation();
              commitLowCutFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.preventDefault();
                event.stopPropagation();
                commitLowCutFromPointer(event, "flush");
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            style={
              {
                "--eq-point-x": `${eqPointX(lowCutFrequencyValue)}%`,
                "--eq-point-y": `${eqPointY(0)}%`,
              } as CSSProperties
            }
            type="button"
          >
            <span>LC</span>
          </button>
          {eqBands.map((band) => (
            <button
              aria-label={`${channel.name} Band ${band.label} EQ point`}
              className={styles.eqPoint}
              // A band with no audible effect (the equaliser bypassed, or no
              // gain) reads as a ghost: armed but doing nothing.
              data-ghost={!eq.enabled || Math.abs(band.gainDb) < 0.05}
              data-lit={band.id === activeEqHandleId ? "" : undefined}
              data-selected={band.id === activeEqHandleId}
              data-testid={`audio-eq-point-${band.id}`}
              disabled={!canEdit}
              key={band.id}
              onClick={(event) => {
                if (pressedWithoutMoving(event)) openBandPopover(band.id);
              }}
              onPointerCancel={(event) => {
                eqDragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                pressRef.current = { x: event.clientX, y: event.clientY };
                const graph = event.currentTarget.closest("[data-eq-graph]");
                if (graph instanceof HTMLElement) {
                  const rect = graph.getBoundingClientRect();
                  eqDragRef.current = {
                    bandId: band.id,
                    height: Math.max(1, rect.height),
                    left: rect.left,
                    pointerId: event.pointerId,
                    top: rect.top,
                    width: Math.max(1, rect.width),
                  };
                }
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                commitEqPointFromPointer(event, band);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                event.preventDefault();
                event.stopPropagation();
                commitEqPointFromPointer(event, band);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.preventDefault();
                  event.stopPropagation();
                  commitEqPointFromPointer(event, band, "flush");
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                eqDragRef.current = null;
              }}
              style={
                {
                  "--eq-point-x": `${eqPointX(band.frequencyHz)}%`,
                  "--eq-point-y": `${eqPointY(band.gainDb)}%`,
                } as CSSProperties
              }
              type="button"
            >
              <span>{band.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        ref={tableRef}
        className={styles.eqTable}
        role="table"
        aria-label={`${channel.name} equaliser bands`}
        // A band key keeps the focus while the popover shows its band: an Esc
        // there closes the popover first, as one in the popover does, and an
        // armed key elsewhere is left for the next Esc (DESIGN.md §9).
        onKeyDown={(event) => {
          if (event.key !== "Escape" || openBand === null) return;
          event.preventDefault();
          event.stopPropagation();
          setOpenBand(null);
        }}
      >
        <div className={styles.eqRow} role="row">
          <span className={styles.eqRowLabel} role="rowheader">
            Band
          </span>
          {columns.map((column) => (
            <span key={column.id} role="columnheader" className={styles.eqHead}>
              <Key
                size="small"
                selected={activeEqHandleId === column.id}
                aria-expanded={openBand === column.id}
                aria-haspopup="true"
                data-active={column.band ? eq.enabled : lowCut.enabled}
                onClick={() => (openBand === column.id ? setOpenBand(null) : openBandPopover(column.id))}
              >
                {column.key}
              </Key>
            </span>
          ))}
        </div>
        {(
          [
            [
              "Type",
              (band: AudioEqBand | null) => (band ? formatEqBandType(band.bandType) : lowCut.enabled ? "on" : "off"),
            ],
            [
              "Frequency",
              (band: AudioEqBand | null) => formatEqFrequency(band ? band.frequencyHz : lowCutFrequencyValue),
            ],
            [
              "Gain",
              (band: AudioEqBand | null) =>
                band ? `${formatEqGain(band.gainDb)} dB` : `${lowCut.slopeDbPerOctave} dB/oct`,
            ],
            ["Q", (band: AudioEqBand | null) => (band ? band.q.toFixed(1) : "–")],
          ] as const
        ).map(([label, cell]) => (
          <div key={label} className={styles.eqRow} role="row">
            <span className={styles.eqRowLabel} role="rowheader">
              {label}
            </span>
            {columns.map((column) => (
              <span
                key={column.id}
                role="cell"
                className={styles.eqCell}
                data-off={(column.band ? !eq.enabled : !lowCut.enabled) ? "" : undefined}
              >
                {cell(column.band)}
              </span>
            ))}
          </div>
        ))}
      </div>

      <Popover
        open={openColumn !== null}
        anchor={tableRef.current}
        onClose={() => setOpenBand(null)}
        title={openColumn ? (openColumn.band ? `Band ${openColumn.band.label}` : "Low Cut") : undefined}
        placement="bottom-start"
        width={407}
        // The band keys are in the table: a press on one moves the popover to
        // its band, or closes it, rather than closing and opening again.
        ignoreOutside={[tableRef]}
        testId="audio-eq-control-tray"
      >
        {openColumn && !openColumn.band ? (
          <div className={styles.popoverBody} data-testid="audio-eq-lowcut-card">
            <div className={styles.popoverRow}>
              <AudioKnob
                ariaLabel={`${channel.name} Low Cut frequency`}
                caption="Cutoff"
                disabled={!canEdit}
                format={formatEqFrequency}
                max={LOW_CUT_FREQUENCY_MAX}
                min={LOW_CUT_FREQUENCY_MIN}
                numericFieldLabel="Cutoff frequency"
                numericSuffix="Hz"
                onCommit={(value) => {
                  setDraftValue(lowCutFrequencyKey, value);
                  onUpdateChannelEq({ channelId: channel.id, lowCutFrequencyHz: value });
                  clearDraftValueLater(lowCutFrequencyKey);
                }}
                onPreview={(value) => setDraftValue(lowCutFrequencyKey, value)}
                onRequestTypedEntry={() => {
                  setOpenBand(null);
                  ask({
                    title: `Set ${channel.name} Low Cut frequency`,
                    fieldLabel: "Cutoff frequency",
                    value: Math.round(lowCutFrequencyValue),
                    min: LOW_CUT_FREQUENCY_MIN,
                    max: LOW_CUT_FREQUENCY_MAX,
                    step: 1,
                    suffix: "Hz",
                    onConfirm: (value) => onUpdateChannelEq({ channelId: channel.id, lowCutFrequencyHz: value }),
                  });
                }}
                size={56}
                step={1}
                value={lowCutFrequencyValue}
              />
              <div className={styles.popoverControls}>
                <Key
                  mode="toggle"
                  engaged={lowCut.enabled}
                  locked={!canEdit}
                  reason={lock ?? undefined}
                  data-active={lowCut.enabled}
                  onClick={() => onUpdateChannelEq({ channelId: channel.id, lowCutEnabled: !lowCut.enabled })}
                >
                  {lowCut.enabled ? "Bypass Low Cut" : "Enable Low Cut"}
                </Key>
                <span className={styles.popoverLabel}>Slope, dB/oct</span>
                <Segmented label="Low Cut slope">
                  {LOW_CUT_SLOPES.map((slope) => (
                    <Key
                      key={slope}
                      mode="segmented"
                      engaged={lowCut.slopeDbPerOctave === slope}
                      locked={!canEdit}
                      reason={lock ?? undefined}
                      aria-pressed={lowCut.slopeDbPerOctave === slope}
                      data-active={lowCut.slopeDbPerOctave === slope}
                      onClick={() => onUpdateChannelEq({ channelId: channel.id, lowCutSlopeDbPerOctave: slope })}
                    >
                      {String(slope)}
                    </Key>
                  ))}
                </Segmented>
              </div>
            </div>
          </div>
        ) : null}
        {openColumn?.band ? (
          <AudioEqBandControls
            ask={(entry) => {
              setOpenBand(null);
              ask(entry);
            }}
            band={openColumn.band}
            canEdit={canEdit}
            channel={channel}
            clearDraftValueLater={clearDraftValueLater}
            lock={lock}
            onUpdateChannelEq={onUpdateChannelEq}
            setDraftValue={setDraftValue}
          />
        ) : null}
      </Popover>
    </Section>
  );
}

function AudioEqBandControls({
  ask,
  band,
  canEdit,
  channel,
  clearDraftValueLater,
  lock,
  onUpdateChannelEq,
  setDraftValue,
}: {
  ask: (entry: PlateValueEntry) => void;
  band: AudioEqBand;
  canEdit: boolean;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  lock: string | null;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
}) {
  const gainKey = `channel:${channel.id}:eq:${band.id}:gain`;
  const freqKey = `channel:${channel.id}:eq:${band.id}:frequency`;
  const qKey = `channel:${channel.id}:eq:${band.id}:q`;
  // TotalMix fixes band 2 to Bell: the one type is shown, locked, with why.
  const fixedType = band.id === "2";
  const send = (patch: Omit<AudioEqUpdate, "channelId" | "bandId">) =>
    onUpdateChannelEq({ bandId: eqBandId(band.id), channelId: channel.id, ...patch });
  const knob = (
    kind: "gain" | "frequency" | "q",
    props: { caption: string; min: number; max: number; step: number; suffix?: string; value: number; key: string }
  ) => {
    const patch = (value: number): Omit<AudioEqUpdate, "channelId" | "bandId"> =>
      kind === "gain" ? { gainDb: value } : kind === "frequency" ? { frequencyHz: value } : { q: value };
    const name = kind === "q" ? "Q" : kind;
    return (
      <AudioKnob
        ariaLabel={`${channel.name} Band ${band.label} EQ ${name}`}
        bipolar={kind === "gain"}
        caption={props.caption}
        defaultValue={kind === "gain" ? 0 : undefined}
        disabled={!canEdit}
        format={
          kind === "gain"
            ? formatEqGain
            : kind === "frequency"
              ? formatEqFrequency
              : (value: number) => `Q ${value.toFixed(1)}`
        }
        max={props.max}
        min={props.min}
        numericFieldLabel={props.caption}
        numericSuffix={props.suffix}
        onCommit={(value) => {
          setDraftValue(props.key, value);
          send(patch(value));
          clearDraftValueLater(props.key);
        }}
        onPreview={(value) => setDraftValue(props.key, value)}
        onRequestTypedEntry={() =>
          ask({
            title: `Set ${channel.name} Band ${band.label} EQ ${name}`,
            fieldLabel: props.caption,
            value: props.value,
            min: props.min,
            max: props.max,
            step: props.step,
            suffix: props.suffix,
            resetValue: kind === "gain" ? 0 : undefined,
            onConfirm: (value) => send(patch(value)),
          })
        }
        size={56}
        step={props.step}
        value={props.value}
      />
    );
  };

  return (
    <div className={styles.popoverBody} data-testid={`audio-eq-band-card-${band.id}`}>
      <Segmented label={`Band ${band.label} type`}>
        {eqBandTypeOptionsFor(band.id).map((option) => (
          <Key
            key={option}
            mode="segmented"
            engaged={band.bandType === option}
            locked={!canEdit || fixedType}
            reason={fixedType ? "TotalMix fixes band 2 to Bell" : (lock ?? undefined)}
            aria-pressed={band.bandType === option}
            data-active={band.bandType === option}
            onClick={() => send({ bandType: eqBandType(option) })}
          >
            {formatEqBandType(option)}
          </Key>
        ))}
      </Segmented>
      <div className={styles.popoverKnobs}>
        {knob("gain", {
          caption: "Gain",
          min: EQ_GAIN_MIN,
          max: EQ_GAIN_MAX,
          step: 0.5,
          suffix: "dB",
          value: band.gainDb,
          key: gainKey,
        })}
        {knob("frequency", {
          caption: "Frequency",
          min: EQ_FREQUENCY_MIN,
          max: EQ_FREQUENCY_MAX,
          step: 10,
          suffix: "Hz",
          value: band.frequencyHz,
          key: freqKey,
        })}
        {knob("q", { caption: "Q", min: EQ_Q_MIN, max: EQ_Q_MAX, step: 0.1, value: band.q, key: qKey })}
      </div>
    </div>
  );
}
