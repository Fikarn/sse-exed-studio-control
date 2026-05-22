/**
 * EQ state + derived view-values + pointer commit handlers for the
 * audio inspector. Owned by a hook so the AudioInspector router stays
 * thin while the Channel Overview EQ mini card and the EQ tab body
 * can consume the same draft state via `{...eqState}` spreads.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AUDIO_DRAFT_CLEAR_MS, AUDIO_THROTTLE_EQ_MS } from "../audioConstants";
import { createThrottledCommit } from "../audioContinuousControls";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import {
  eqBandId,
  eqFrequencyFromPointX,
  eqGainFromPointY,
  eqResponsePath,
  formatEqFrequency,
  LOW_CUT_HANDLE_ID,
  lowCutFrequencyFromPointX,
  lowCutShadePath,
  type AudioEqBand,
  type AudioEqUpdate,
  type EqDragRef,
  type SelectedAudioChannel,
} from "../components/inspector/audioInspectorHelpers";

interface UseAudioInspectorEqStateArgs {
  viewModel: AudioWorkspaceViewModel;
  selectedChannel: SelectedAudioChannel | null;
  getDraftValue: (key: string, fallback: number) => number;
  setDraftValue: (key: string, value: number) => void;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelEqContinuous: (request: AudioEqUpdate) => void;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
}

export function useAudioInspectorEqState({
  viewModel,
  selectedChannel,
  getDraftValue,
  setDraftValue,
  clearDraftValueLater,
  commitChannelEqContinuous,
  onUpdateChannelEq,
}: UseAudioInspectorEqStateArgs) {
  const [selectedEqBandId, setSelectedEqBandId] = useState<string | null>(LOW_CUT_HANDLE_ID);
  const [eqGraphDraft, setEqGraphDraft] = useState<{
    bandId: string;
    frequencyHz: number;
    gainDb: number;
  } | null>(null);
  const eqDragRef = useRef<EqDragRef | null>(null);
  const throttledEqCommit = useMemo(
    () => createThrottledCommit<AudioEqUpdate>(commitChannelEqContinuous, AUDIO_THROTTLE_EQ_MS),
    [commitChannelEqContinuous]
  );

  useEffect(() => () => throttledEqCommit.cancel(), [throttledEqCommit]);

  const channelId = selectedChannel?.id ?? "none";
  const activeEqHandleId =
    selectedEqBandId === LOW_CUT_HANDLE_ID
      ? LOW_CUT_HANDLE_ID
      : (selectedChannel?.eq.bands.find((b) => b.id === selectedEqBandId)?.id ??
        selectedChannel?.eq.bands[0]?.id ??
        LOW_CUT_HANDLE_ID);
  const activeEqBand = selectedChannel?.eq.bands.find((b) => b.id === activeEqHandleId) ?? null;
  const activeBandId = activeEqBand?.id ?? "none";
  const lowCutFrequencyKey = `channel:${channelId}:eq:lowCut:frequency`;
  const lowCutFrequencyValue = selectedChannel
    ? getDraftValue(lowCutFrequencyKey, selectedChannel.eq.lowCut.frequencyHz)
    : 80;
  const activeEqBandFrequencyKey = `channel:${channelId}:eq:${activeBandId}:frequency`;
  const activeEqBandFrequencyValue = activeEqBand
    ? getDraftValue(activeEqBandFrequencyKey, activeEqBand.frequencyHz)
    : 0;
  const activeEqBandGainKey = `channel:${channelId}:eq:${activeBandId}:gain`;
  const activeEqBandGainValue = activeEqBand ? getDraftValue(activeEqBandGainKey, activeEqBand.gainDb) : 0;
  const activeEqBandQKey = `channel:${channelId}:eq:${activeBandId}:q`;
  const activeEqBandQValue = activeEqBand ? getDraftValue(activeEqBandQKey, activeEqBand.q) : 0;
  const activeEqBandTypeOptions =
    activeEqBand?.id === "1"
      ? ["bell", "low-shelf", "high-pass", "low-pass"]
      : activeEqBand?.id === "3"
        ? ["bell", "high-shelf", "low-pass", "high-pass"]
        : ["bell"];
  // Why: TotalMix Band 2 is fixed-Bell. Single capability swap if RME unlocks it.
  const canChangeBandType = activeEqBand?.id !== "2";
  const eqBands = selectedChannel
    ? selectedChannel.eq.bands.map((band) =>
        eqGraphDraft?.bandId === band.id
          ? { ...band, frequencyHz: eqGraphDraft.frequencyHz, gainDb: eqGraphDraft.gainDb }
          : band
      )
    : [];
  const visualEq = selectedChannel
    ? {
        ...selectedChannel.eq,
        lowCut: { ...selectedChannel.eq.lowCut, frequencyHz: lowCutFrequencyValue },
        bands: eqBands,
      }
    : null;
  const eqGraphPath = visualEq ? eqResponsePath(visualEq) : "";
  const lowCutShade = visualEq?.lowCut.enabled ? lowCutShadePath(visualEq.lowCut) : "";
  const activeEqLabel =
    activeEqHandleId === LOW_CUT_HANDLE_ID ? "Low Cut" : activeEqBand ? `Band ${activeEqBand.label}` : "EQ";
  const activeEqValue =
    activeEqHandleId === LOW_CUT_HANDLE_ID
      ? `${formatEqFrequency(lowCutFrequencyValue)} · ${selectedChannel?.eq.lowCut.slopeDbPerOctave ?? 12} dB/oct`
      : activeEqBand
        ? `${formatEqFrequency(activeEqBand.frequencyHz)} · ${activeEqBand.gainDb.toFixed(1)} dB · Q ${activeEqBand.q.toFixed(1)}`
        : "No band selected";

  const commitEqPointFromPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    band: AudioEqBand,
    mode: "schedule" | "flush" = "schedule"
  ) => {
    if (!selectedChannel || !viewModel.capabilities.canEditProcessing) return;
    // Why: re-read the EQ graph rect every pointer event so resize mid-drag
    // (scaled-preview toggle, virtual-keyboard reflow) does not lag the
    // drag sideways. `eqDragRef` still anchors band+pointer identity.
    const graph = event.currentTarget.closest("[data-eq-graph]");
    if (!(graph instanceof HTMLElement)) return;

    const rect = graph.getBoundingClientRect();
    const frequencyPercent = (event.clientX - rect.left) / Math.max(1, rect.width);
    const gainPercent = (event.clientY - rect.top) / Math.max(1, rect.height);
    const frequencyHz = eqFrequencyFromPointX(frequencyPercent);
    const gainDb = eqGainFromPointY(gainPercent);
    const frequencyKey = `channel:${selectedChannel.id}:eq:${band.id}:frequency`;
    const gainKey = `channel:${selectedChannel.id}:eq:${band.id}:gain`;
    setSelectedEqBandId(band.id);
    setEqGraphDraft({ bandId: band.id, frequencyHz, gainDb });
    setDraftValue(frequencyKey, frequencyHz);
    setDraftValue(gainKey, gainDb);
    if (mode === "flush") {
      throttledEqCommit.schedule({
        bandId: eqBandId(band.id),
        channelId: selectedChannel.id,
        frequencyHz,
        gainDb,
      });
      throttledEqCommit.flush();
      clearDraftValueLater(frequencyKey);
      clearDraftValueLater(gainKey);
      window.setTimeout(() => setEqGraphDraft(null), AUDIO_DRAFT_CLEAR_MS);
    }
  };

  const commitLowCutFromPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: "schedule" | "flush" = "schedule"
  ) => {
    if (!selectedChannel || !viewModel.capabilities.canEditProcessing) return;
    const graph = event.currentTarget.closest("[data-eq-graph]");
    if (!(graph instanceof HTMLElement)) return;

    const rect = graph.getBoundingClientRect();
    const frequencyPercent = (event.clientX - rect.left) / Math.max(1, rect.width);
    const frequencyHz = lowCutFrequencyFromPointX(frequencyPercent);
    const frequencyKey = `channel:${selectedChannel.id}:eq:lowCut:frequency`;
    setSelectedEqBandId(LOW_CUT_HANDLE_ID);
    setDraftValue(frequencyKey, frequencyHz);
    if (mode === "flush") {
      onUpdateChannelEq({
        channelId: selectedChannel.id,
        lowCutFrequencyHz: frequencyHz,
      });
      clearDraftValueLater(frequencyKey);
    }
  };

  return {
    activeEqBand,
    activeEqBandFrequencyKey,
    activeEqBandFrequencyValue,
    activeEqBandGainKey,
    activeEqBandGainValue,
    activeEqBandQKey,
    activeEqBandQValue,
    activeEqBandTypeOptions,
    activeEqHandleId,
    activeEqLabel,
    activeEqValue,
    canChangeBandType,
    commitEqPointFromPointer,
    commitLowCutFromPointer,
    eqBands,
    eqDragRef,
    eqGraphPath,
    lowCutFrequencyKey,
    lowCutFrequencyValue,
    lowCutShade,
    selectedEqBandId,
    setSelectedEqBandId,
  };
}
