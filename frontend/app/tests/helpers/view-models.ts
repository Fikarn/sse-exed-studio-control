import type { AudioSnapshot } from "@sse/engine-client";

import { buildAudioPaletteRegistrationSignature, buildAudioViewModel } from "../../src/app/audio/audioViewModel";

// plan PR 4 / workstream D4: pure-logic view-model helpers reused by the
// audio + lighting specs to construct view models without going through
// the live store. Module-scope to avoid recomputing.

export const EMPTY_AUDIO_GROUP_SELECTIONS = {
  "hardware-inputs": [],
  "software-playback": [],
};

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildAudioTestViewModel(audioSnapshot: AudioSnapshot) {
  return buildAudioViewModel({
    activeChannelGroups: EMPTY_AUDIO_GROUP_SELECTIONS,
    appSnapshot: null,
    audioSnapshot,
    bankIndex: 0,
    density: "desktop",
  });
}

export function audioPaletteSignatureForSnapshot(audioSnapshot: AudioSnapshot) {
  const viewModel = buildAudioTestViewModel(audioSnapshot);
  return buildAudioPaletteRegistrationSignature(viewModel, [
    ...viewModel.hardwareInputs.channels,
    ...viewModel.softwarePlayback.channels,
  ]);
}
