import type {
  EventEnvelope,
  EventName,
  JsonObject,
  JsonValue,
  RequestMethod,
  StartupLifecycleState,
} from "./generated/protocol";
import type { AudioSnapshot } from "./generated/snapshots/AudioSnapshot";
import type { LightingDmxMonitorSnapshot } from "./generated/snapshots/LightingDmxMonitorSnapshot";
import type { LightingFixtureCatalogSnapshot } from "./generated/snapshots/LightingFixtureCatalogSnapshot";
import type { LightingPaletteKind } from "./generated/snapshots/LightingPaletteKind";
import type { LightingSnapshot } from "./generated/snapshots/LightingSnapshot";
import type { PrompterGlassSnapshot } from "./generated/snapshots/PrompterGlassSnapshot";
import type { PrompterLayoutLine } from "./generated/snapshots/PrompterLayoutLine";
import type { PrompterLook } from "./generated/snapshots/PrompterLook";
import type { PrompterParagraph } from "./generated/snapshots/PrompterParagraph";
import type { PrompterPlace } from "./generated/snapshots/PrompterPlace";
import type { PrompterScriptSnapshot } from "./generated/snapshots/PrompterScriptSnapshot";
import type { PrompterSnapshot } from "./generated/snapshots/PrompterSnapshot";

/** The pages, in the tab order (new pages program: the Teleprompter since Slice 6a, D4). */
export type WorkspaceId = "setup" | "lighting" | "audio" | "teleprompter";
export type RecoveryState = "healthy" | "degraded" | "recovery";
export type CommissioningStage = "setup-required" | "in-progress" | "ready";
export type RunnerStage = "import" | "probe" | "map" | "verify" | "publish";
export type CommissioningCheckTarget = "control-surface" | "lighting" | "audio";
export type SetupSection = "commissioning" | "support";

export interface CommissioningCheckRequest {
  target: CommissioningCheckTarget;
  bridgeIp?: string;
  universe?: number;
  sendHost?: string;
  sendPort?: number;
  receivePort?: number;
}

export interface CommissioningUpdateRequest {
  stage?: CommissioningStage;
  runnerStage?: RunnerStage;
  hardwareProfile?: string;
  /**
   * 2026-09 audit Slice 8: `stage: "ready"` is refused by the engine while
   * any commissioning probe is not passed (`COMMISSIONING_PROBES_INCOMPLETE`)
   * unless this is `true` — the operator's explicit, recorded decision.
   */
  overrideProbes?: boolean;
}

export interface LightingSettingsUpdateRequest {
  selectedSceneId?: string | null;
  selectedFixtureId?: string | null;
  /** 0–100 multiplier applied to every fixture's intensity in DMX output. */
  grandMaster?: number;
}

export interface AudioSettingsUpdateRequest {
  oscEnabled?: boolean;
  sendHost?: string;
  sendPort?: number;
  receivePort?: number;
  selectedChannelId?: string | null;
  selectedMixTargetId?: string;
  expectedPeakData?: boolean;
  expectedSubmixLock?: boolean;
  expectedCompatibilityMode?: boolean;
  fadersPerBank?: number;
  viewMode?: "submix" | "master";
}

export interface AudioChannelUpdateRequest {
  channelId: string;
  mixTargetId?: string;
  name?: string;
  gain?: number;
  fader?: number;
  mute?: boolean;
  solo?: boolean;
  phantom?: boolean;
  phase?: boolean;
  pad?: boolean;
  instrument?: boolean;
  autoSet?: boolean;
}

/** `prompter.speed`: a pace in words a minute, or a number of 5-word steps (`step: 1` is 5 words a minute faster; new pages program, Slice 6a). */
export type PrompterSpeedRequest = { wpm: number } | { step: number };

/** `prompter.jump`: where the reading line goes; `paragraph` counts from 0. */
export type PrompterJumpRequest =
  | {
      to:
        | "top"
        | "back"
        | "nextLine"
        | "previousLine"
        | "nextParagraph"
        | "previousParagraph"
        | "nextCue"
        | "previousCue";
    }
  | { to: "paragraph"; paragraph: number }
  | { to: "place"; paragraph: number; word: number };

/** `prompter.textSize`: a size in pixels, a number of 4 px steps (`step: -1` is 4 px smaller), or the look's standard. */
export type PrompterTextSizeRequest = { sizePx: number } | { step: number } | { standard: true };

/** `prompter.look.update`: any of the look's fields. */
export type PrompterLookUpdateRequest = Partial<PrompterLook>;

/** `prompter.layout.report`: what the glass measured for a layout key. */
export interface PrompterLayoutReportRequest {
  layoutKey: string;
  lines: PrompterLayoutLine[];
  endTop: number;
}

/** `prompter.script.import`: a file the page's own picker read, as its name and bytes. */
export interface PrompterScriptImportRequest {
  fileName: string;
  contentBase64: string;
  /** The script whose text the file becomes (its earlier text kept as a version). */
  updateScriptId?: string;
}

export interface AudioSnapshotCreateRequest {
  name: string;
  oscIndex: number;
  captureCurrentState?: boolean;
}

export interface AudioSnapshotUpdateRequest {
  snapshotId: string;
  name?: string;
  oscIndex?: number;
  captureCurrentState?: boolean;
}

export interface AudioSnapshotDeleteRequest {
  snapshotId: string;
}

export interface AudioClipClearRequest {
  channelId?: string;
}

export interface AudioEqUpdateRequest {
  channelId: string;
  enabled?: boolean;
  lowCutEnabled?: boolean;
  lowCutFrequencyHz?: number;
  lowCutSlopeDbPerOctave?: 6 | 12 | 18 | 24;
  bandId?: "1" | "2" | "3";
  bandEnabled?: boolean;
  bandType?: "bell" | "low-shelf" | "high-shelf" | "high-pass" | "low-pass";
  frequencyHz?: number;
  gainDb?: number;
  q?: number;
}

export interface AudioDynamicsUpdateRequest {
  channelId: string;
  section: "compressor" | "gate";
  enabled?: boolean;
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  makeupDb?: number;
}

export interface AudioSendModeUpdateRequest {
  channelId: string;
  mixTargetId: string;
  preFader?: boolean;
  mute?: boolean;
  linkStereo?: boolean;
  solo?: boolean;
}

export interface AudioMixTargetUpdateRequest {
  mixTargetId: string;
  volume?: number;
  mute?: boolean;
  dim?: boolean;
  mono?: boolean;
  talkback?: boolean;
}

/**
 * `audio.talkback.hold` (2026-09 audit Slice 6): talkback is momentary.
 * `engaged: true` engages or re-arms the hold (the frontend re-sends it every
 * 750 ms while held), `false` releases it. `mixTargetId` defaults to Main.
 */
export interface AudioTalkbackHoldRequest {
  mixTargetId?: string;
  engaged: boolean;
}

export interface LightingFixtureUpdateRequest {
  fixtureId: string;
  name?: string;
  type?: string;
  definitionId?: string;
  modeId?: string;
  universe?: number;
  on?: boolean;
  intensity?: number;
  cct?: number;
  controlValues?: Record<string, number>;
  dmxStartAddress?: number;
  groupId?: string | null;
  spatialX?: number | null;
  spatialY?: number | null;
  spatialRotation?: number;
  rigZ?: number | null;
  beamAngleDegrees?: number | null;
}

export interface LightingFixtureCreateRequest {
  name: string;
  type?: string;
  definitionId: string;
  modeId: string;
  universe?: number;
  dmxStartAddress: number;
  groupId?: string;
}

export interface LightingSceneCreateRequest {
  name: string;
  fixtureStates?: Array<{
    fixtureId: string;
    intensity: number;
    cct: number;
    on: boolean;
    controlValues?: Record<string, number>;
  }>;
  colorIndex?: number | null;
}

export interface LightingSceneUpdateRequest {
  sceneId: string;
  /** New name. Optional — at least one of name / captureCurrentState / colorIndex is required. */
  name?: string;
  /**
   * When true, the scene's saved fixtureStates are overwritten with the live
   * rig state. Used for "Save changes" without delete+recreate.
   */
  captureCurrentState?: boolean;
  /**
   * Operator-assigned color tag (Ableton-style). Palette index 0..7 to
   * set, `null` to clear, or omit to leave unchanged.
   */
  colorIndex?: number | null;
}

export interface LightingPreviewModeRequest {
  enabled: boolean;
  patchModeActive?: boolean;
}

export interface LightingPaletteCreateRequest {
  name: string;
  kind: LightingPaletteKind;
  value: number;
  colorIndex?: number | null;
}

export interface LightingPaletteUpdateRequest {
  paletteId: string;
  name?: string;
  value?: number;
  colorIndex?: number | null;
  beforePaletteId?: string | null;
}

export interface LightingPaletteApplyRequest {
  paletteId: string;
  fixtureIds: readonly string[];
  patchModeActive?: boolean;
}

export interface LightingGroupUpdateRequest {
  groupId: string;
  /** New name. Optional — at least one of name / colorIndex is required. */
  name?: string;
  /**
   * Operator-assigned color tag (Ableton-style). Palette index 0..7 to
   * set, `null` to clear, or omit to leave unchanged.
   */
  colorIndex?: number | null;
}

/**
 * What the shell reported when it launched the engine (2026-09 production
 * readiness, Slice 5 — finding F09): the launch number within this shell
 * and the process id. The fixture transport reports nothing.
 */
export interface EngineLaunchInfo {
  generation: number | null;
  pid: number | null;
}

/**
 * A failure that happened in the background and changed nothing on screen
 * (Slice 5): a refresh the engine did not answer, an error nothing caught.
 * The store keeps the last twenty for the diagnostics export.
 */
export interface BackgroundFailure {
  at: string;
  context: string;
  message: string;
}

export interface StartupFailure {
  code: string;
  message: string;
  paths?: Record<string, string>;
  requestedProtocol?: string;
  stage: string;
  supportedProtocol?: string;
}

export interface ShellTalentMark {
  id: string;
  label: string;
  xMeters: number;
  yMeters: number;
}

/**
 * A script a scenario's prompter starts with (new pages program, Slice 6a): its text,
 * cleaned as an edit is, kept with `versions` versions — the first as it came in
 * (`imported` from `sourceFileName`, or `pasted` without one), each later one a
 * paragraph longer, the last its text now. `place` is its own place (the top without
 * it), inside its text or its end; `removed` puts it in Removed.
 */
export interface FixturePrompterScriptSeed {
  name: string;
  paragraphs: PrompterParagraph[];
  /** 40–300 words a minute in steps of 5; 140 without it. */
  speedWpm?: number;
  place?: PrompterPlace;
  sourceFileName?: string | null;
  removed?: boolean;
  /** How many versions it keeps: 1 (the one it came in as) without it, at most 20 and at most its paragraphs. */
  versions?: number;
}

/**
 * The prompter a scenario starts with (new pages program, Slice 6a), built by the
 * double's own requests so it holds what the hardware link would: the scripts, then
 * `onGlass` put on the prompter (paused at its place, as `prompter.putOn` leaves it),
 * then, with `notUpdated`, a sentence added to that script's paragraph after the place,
 * so the glass shows the earlier text and the prompter reads NOT UPDATED. `look` and
 * `sizePx` are held to `prompter.look.update`'s and `prompter.textSize`'s ranges. A seed
 * the prompter could not hold is the scenario's mistake, and says so.
 */
export interface FixturePrompterSeed {
  scripts?: FixturePrompterScriptSeed[];
  /** The name of the script on the glass; nothing is on it without one. */
  onGlass?: string;
  notUpdated?: boolean;
  look?: Partial<PrompterLook>;
  sizePx?: number;
}

export interface FixtureScenario {
  appSnapshot?: JsonObject;
  healthSnapshot?: JsonObject;
  commissioningSnapshot?: JsonObject;
  lightingFixtureCatalogSnapshot?: JsonObject;
  lightingSnapshot?: JsonObject;
  audioSnapshot?: JsonObject | null;
  audioMeteringActive?: boolean;
  supportSnapshot?: JsonObject;
  controlSurfaceSnapshot?: JsonObject;
  startupDelayMs?: number;
  startupFailure?: JsonObject;
  /** The Prompter XL the double starts with, as a `prompter.screen.report`'s params, or
   *  `"unreported"` as every start of the hardware link begins; without it, connected at
   *  1920×1080, 60 Hz (new pages program, Slice 5a). */
  prompterScreen?: JsonObject | "unreported";
  /** The scripts, the look and the glass the double's prompter starts with; without it, no
   *  scripts, the standard look at 88 px and nothing on the glass (new pages program,
   *  Slice 6a; `fixture/prompterSeed.ts`). */
  prompter?: FixturePrompterSeed;
}

export interface EngineTransport {
  initialize?(): Promise<void | EngineLaunchInfo>;
  request(method: RequestMethod, params?: JsonObject): Promise<JsonValue>;
  subscribe(listener: (event: EventEnvelope<EventName>) => void): () => void;
  dispose?(): Promise<void>;
}

export interface AudioMeterEntry {
  channelPathClip?: boolean;
  channelPathClipHold?: boolean;
  clip?: boolean;
  clipHold?: boolean;
  levelLeftDbfs: number;
  levelRightDbfs: number;
  lufs?: number | null;
  meterPointOver?: boolean;
  meterPointOverLeft?: boolean;
  meterPointOverRight?: boolean;
  meterPoint?: string | null;
  over?: boolean;
  overLeft?: boolean;
  overRight?: boolean;
  peakHoldLeftDbfs: number;
  peakHoldRightDbfs: number;
  peakLeftDbfs: number;
  peakRightDbfs: number;
  peakWarning?: boolean;
  rmsLeftDbfs: number;
  rmsRightDbfs: number;
  meterLeft: number;
  meterLevel?: number;
  meterRight: number;
  peakHoldLeft: number;
  peakHoldRight: number;
}

export interface AudioMeterFrame {
  activeMixTargetId: string | null;
  cadenceHz: number | null;
  channels: Record<string, AudioMeterEntry>;
  diagnostics?: JsonObject | null;
  lastPacketAgeMs: number | null;
  meteringSource: string | null;
  meteringState: string | null;
  mixTargets: Record<string, AudioMeterEntry>;
  monotonicTimestampMs: number | null;
  sequence: number;
}

export interface ShellState {
  lifecycle: StartupLifecycleState;
  recovery: RecoveryState;
  activeWorkspace: WorkspaceId;
  // Snapshots that the engine assembles ad-hoc as serde_json::Value
  // remain loose-typed; the engine boundary is the contract for these.
  appSnapshot: JsonObject | null;
  healthSnapshot: JsonObject | null;
  commissioningSnapshot: JsonObject | null;
  supportSnapshot: JsonObject | null;
  controlSurfaceSnapshot: JsonObject | null;
  // Snapshots backed by typed Rust structs (see ts-rs annotations in
  // native/rust-engine/src/{lighting,audio}). Regenerated via
  // `npm run protocol:generate`.
  lightingSnapshot: LightingSnapshot | null;
  lightingFixtureCatalogSnapshot: LightingFixtureCatalogSnapshot | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  audioSnapshot: AudioSnapshot | null;
  /**
   * The Teleprompter (new pages program, Slice 6a): the scripts, the look, the
   * Prompter XL, and the script on the glass with its anchor.
   */
  prompterSnapshot: PrompterSnapshot | null;
  /**
   * The text on the glass, fetched again only when the glass's layout key
   * changes (it can hold 30,000 words); read the look and the anchor from
   * `prompterSnapshot`, which is always current.
   */
  prompterGlassSnapshot: PrompterGlassSnapshot | null;
  startupFailure: StartupFailure | null;
  lastEvent: EventName | null;
  errorSummary: string | null;
  backgroundFailures: BackgroundFailure[];
  /**
   * Development builds only (Slice 9): the reply that failed its shape guard,
   * request and field named. `useShellSnapshot` throws it while rendering.
   */
  snapshotFault: string | null;
}

export interface ShellStore {
  initialize(): Promise<void>;
  getSnapshot(): ShellState;
  getAudioMeterFrame(): AudioMeterFrame;
  refresh(): Promise<void>;
  restart(): Promise<void>;
  /** Records a failure that changed nothing on screen (Slice 5); last twenty kept. */
  reportBackgroundFailure(error: unknown, context?: string): void;
  subscribeAudioMeters(listener: () => void): () => void;
  setWorkspace(workspaceId: WorkspaceId): Promise<JsonValue>;
  setSetupSection(section: SetupSection): Promise<JsonValue>;
  setLightingSection(sectionId: string | null): Promise<JsonValue>;
  setLightingSceneThumbs(thumbs: Record<string, string>): Promise<JsonValue>;
  setLightingTalentMarks(marks: readonly ShellTalentMark[]): Promise<JsonValue>;
  runCommissioningCheck(request: CommissioningCheckRequest): Promise<JsonValue>;
  updateCommissioning(request: CommissioningUpdateRequest): Promise<JsonValue>;
  syncAudio(): Promise<JsonValue>;
  recallAudioSnapshot(snapshotId: string): Promise<JsonValue>;
  createAudioSnapshot(request: AudioSnapshotCreateRequest): Promise<JsonValue>;
  updateAudioSnapshot(request: AudioSnapshotUpdateRequest): Promise<JsonValue>;
  deleteAudioSnapshot(request: AudioSnapshotDeleteRequest): Promise<JsonValue>;
  clearAudioClips(request?: AudioClipClearRequest): Promise<JsonValue>;
  clearAllAudioSolo(): Promise<JsonValue>;
  updateAudioChannel(request: AudioChannelUpdateRequest): Promise<JsonValue>;
  updateAudioChannelEq(request: AudioEqUpdateRequest): Promise<JsonValue>;
  updateAudioChannelDynamics(request: AudioDynamicsUpdateRequest): Promise<JsonValue>;
  updateAudioChannelSendMode(request: AudioSendModeUpdateRequest): Promise<JsonValue>;
  updateAudioMixTarget(request: AudioMixTargetUpdateRequest): Promise<JsonValue>;
  holdAudioTalkback(request: AudioTalkbackHoldRequest): Promise<JsonValue>;
  updateAudioSettings(request: AudioSettingsUpdateRequest): Promise<JsonValue>;
  updateLightingSettings(request: LightingSettingsUpdateRequest): Promise<JsonValue>;
  createLightingGroup(name: string): Promise<JsonValue>;
  updateLightingGroup(request: LightingGroupUpdateRequest): Promise<JsonValue>;
  deleteLightingGroup(groupId: string): Promise<JsonValue>;
  createLightingFixture(request: LightingFixtureCreateRequest): Promise<JsonValue>;
  createLightingScene(request: LightingSceneCreateRequest): Promise<JsonValue>;
  updateLightingScene(request: LightingSceneUpdateRequest): Promise<JsonValue>;
  setLightingPreviewMode(request: LightingPreviewModeRequest): Promise<JsonValue>;
  discardLightingPreview(): Promise<JsonValue>;
  listLightingPalettes(): Promise<JsonValue>;
  createLightingPalette(request: LightingPaletteCreateRequest): Promise<JsonValue>;
  updateLightingPalette(request: LightingPaletteUpdateRequest): Promise<JsonValue>;
  deleteLightingPalette(paletteId: string): Promise<JsonValue>;
  applyLightingPalette(request: LightingPaletteApplyRequest): Promise<JsonValue>;
  deleteLightingScene(sceneId: string): Promise<JsonValue>;
  reorderLightingScene(sceneId: string, beforeSceneId: string | null): Promise<JsonValue>;
  reorderLightingGroup(groupId: string, beforeGroupId: string | null): Promise<JsonValue>;
  pinLightingScene(sceneId: string, pinned: boolean): Promise<JsonValue>;
  updateLightingFixture(request: LightingFixtureUpdateRequest): Promise<JsonValue>;
  identifyLightingFixture(fixtureId: string, durationMs?: number): Promise<JsonValue>;
  highlightLightingFixtures(fixtureIds: readonly string[], mode: "highlight" | "solo" | "off"): Promise<JsonValue>;
  startLightingIdentifySequence(fixtureIds: readonly string[], stepMs: number, durationMs: number): Promise<JsonValue>;
  clearLightingIdentifyBursts(): Promise<JsonValue>;
  deleteLightingFixture(fixtureId: string): Promise<JsonValue>;
  setLightingGroupPower(groupId: string, on: boolean): Promise<JsonValue>;
  setLightingAllPower(on: boolean): Promise<JsonValue>;
  /** Arms or holds the light outputs (2026-09 production readiness, Slice 11 — F31).
   *  Held, nothing is sent to the rig; everything else keeps working. */
  setLightingOutputArmed(armed: boolean): Promise<JsonValue>;
  recallLightingScene(sceneId: string, fadeMs?: number): Promise<JsonValue>;
  exportSupportBackup(): Promise<JsonValue>;
  /** 2026-09 production readiness, Slice 7 (F20): a database backup answers
   *  `requiresRestart`, and the store restarts the hardware link into it. */
  restoreSupportBackup(path: string): Promise<JsonValue>;
  /** `support.backup.verify`: reads a file inside the backups folder without
   *  changing anything and answers `{ ok, kind, detail, … }`. */
  verifySupportBackup(path: string): Promise<JsonValue>;
  exportCompanionConfig(baseUrl?: string): Promise<JsonValue>;
  // The Teleprompter (new pages program, Slice 6a). Each answers what the
  // hardware link answered, or throws its refusal (`EngineRequestError`).
  putOnPrompter(scriptId: string, replace?: boolean): Promise<JsonValue>;
  updatePrompter(): Promise<JsonValue>;
  clearPrompter(): Promise<JsonValue>;
  playPrompter(): Promise<JsonValue>;
  pausePrompter(): Promise<JsonValue>;
  setPrompterSpeed(request: PrompterSpeedRequest): Promise<JsonValue>;
  jumpPrompter(request: PrompterJumpRequest): Promise<JsonValue>;
  setPrompterTextSize(request: PrompterTextSizeRequest): Promise<JsonValue>;
  updatePrompterLook(request: PrompterLookUpdateRequest): Promise<JsonValue>;
  reportPrompterLayout(request: PrompterLayoutReportRequest): Promise<JsonValue>;
  importPrompterScript(request: PrompterScriptImportRequest): Promise<JsonValue>;
  removePrompterScript(scriptId: string): Promise<JsonValue>;
  restorePrompterScript(scriptId: string): Promise<JsonValue>;
  deletePrompterScript(scriptId: string): Promise<JsonValue>;
  bringBackPrompterVersion(scriptId: string, versionId: number): Promise<JsonValue>;
  /** Reads the prompter's state again: the page follows the place with it while the text scrolls. */
  refreshPrompterSnapshot(): Promise<void>;
  /** One script with its text and its earlier versions (`prompter.script.snapshot`); changes nothing. */
  readPrompterScript(scriptId: string): Promise<PrompterScriptSnapshot>;
  refreshControlSurfaceSnapshot(): Promise<void>;
  getAudioMeterFrame(): AudioMeterFrame;
  subscribeAudioMeters(listener: () => void): () => void;
  subscribe(listener: () => void): () => void;
  dispose(): Promise<void>;
}
