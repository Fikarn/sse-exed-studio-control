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
import type { LightingSnapshot } from "./generated/snapshots/LightingSnapshot";
import type { PlanningSnapshot } from "./generated/snapshots/PlanningSnapshot";

export type WorkspaceId = "setup" | "lighting" | "audio" | "planning";
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
}

export interface LightingSettingsUpdateRequest {
  selectedSceneId?: string | null;
  selectedFixtureId?: string | null;
  /** 0–100 multiplier applied to every fixture's intensity in DMX output. */
  grandMaster?: number;
}

export interface PlanningSettingsUpdateRequest {
  modeSection?: "timeline" | "board";
  timelineStartHour?: number;
  timelineEndHour?: number;
  viewFilter?: "all" | "todo" | "in-progress" | "blocked" | "done";
  selectedProjectId?: string | null;
  selectedTaskId?: string | null;
}

export interface PlanningTaskRescheduleRequest {
  projectId?: string;
  taskId: string;
  scheduledDurationSeconds?: number | null;
  scheduledStart?: string | null;
}

export interface PlanningTaskCreateRequest {
  projectId: string;
  title: string;
  description?: string;
  priority?: "p0" | "p1" | "p2" | "p3";
  dueDate?: string | null;
  labels?: string[];
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
}

export interface AudioChannelUpdateRequest {
  channelId: string;
  mixTargetId?: string;
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

export interface AudioMixTargetUpdateRequest {
  mixTargetId: string;
  volume?: number;
  mute?: boolean;
  dim?: boolean;
  mono?: boolean;
  talkback?: boolean;
}

export interface PlanningProjectCreateRequest {
  title: string;
  description?: string;
  priority?: "p0" | "p1" | "p2" | "p3";
  status?: "todo" | "in-progress" | "blocked" | "done";
}

export interface PlanningProjectReorderRequest {
  projectId: string;
  newStatus?: "todo" | "in-progress" | "blocked" | "done";
  newIndex?: number;
}

export interface LightingFixtureUpdateRequest {
  fixtureId: string;
  name?: string;
  type?: string;
  on?: boolean;
  intensity?: number;
  cct?: number;
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
  type: string;
  dmxStartAddress: number;
  groupId?: string;
}

export interface LightingSceneCreateRequest {
  name: string;
}

export interface LightingSceneUpdateRequest {
  sceneId: string;
  /** New name. Optional — at least one of name / captureCurrentState is required. */
  name?: string;
  /**
   * When true, the scene's saved fixtureStates are overwritten with the live
   * rig state. Used for "Save changes" without delete+recreate.
   */
  captureCurrentState?: boolean;
}

export interface LightingGroupUpdateRequest {
  groupId: string;
  name: string;
}

export interface StartupFailure {
  code: string;
  message: string;
  paths?: Record<string, string>;
  requestedProtocol?: string;
  stage: string;
  supportedProtocol?: string;
}

export interface FixtureScenario {
  appSnapshot?: JsonObject;
  healthSnapshot?: JsonObject;
  commissioningSnapshot?: JsonObject;
  lightingSnapshot?: JsonObject;
  audioSnapshot?: JsonObject | null;
  planningSnapshot?: JsonObject | null;
  supportSnapshot?: JsonObject;
  controlSurfaceSnapshot?: JsonObject;
  startupDelayMs?: number;
  startupFailure?: JsonObject;
}

export interface EngineTransport {
  initialize?(): Promise<void>;
  request(method: RequestMethod, params?: JsonObject): Promise<JsonValue>;
  subscribe(listener: (event: EventEnvelope<EventName>) => void): () => void;
  dispose?(): Promise<void>;
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
  // native/rust-engine/src/{lighting,audio,planning}). Regenerated via
  // `npm run protocol:generate`.
  lightingSnapshot: LightingSnapshot | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  audioSnapshot: AudioSnapshot | null;
  planningSnapshot: PlanningSnapshot | null;
  startupFailure: StartupFailure | null;
  lastEvent: EventName | null;
  errorSummary: string | null;
}

export interface ShellStore {
  initialize(): Promise<void>;
  getSnapshot(): ShellState;
  refresh(): Promise<void>;
  restart(): Promise<void>;
  setWorkspace(workspaceId: WorkspaceId): Promise<JsonValue>;
  setSetupSection(section: SetupSection): Promise<JsonValue>;
  setLightingSection(sectionId: string | null): Promise<JsonValue>;
  setLightingSceneThumbs(thumbs: Record<string, string>): Promise<JsonValue>;
  runCommissioningCheck(request: CommissioningCheckRequest): Promise<JsonValue>;
  updateCommissioning(request: CommissioningUpdateRequest): Promise<JsonValue>;
  syncAudio(): Promise<JsonValue>;
  recallAudioSnapshot(snapshotId: string): Promise<JsonValue>;
  updateAudioChannel(request: AudioChannelUpdateRequest): Promise<JsonValue>;
  updateAudioMixTarget(request: AudioMixTargetUpdateRequest): Promise<JsonValue>;
  updateAudioSettings(request: AudioSettingsUpdateRequest): Promise<JsonValue>;
  updateLightingSettings(request: LightingSettingsUpdateRequest): Promise<JsonValue>;
  createLightingGroup(name: string): Promise<JsonValue>;
  updateLightingGroup(request: LightingGroupUpdateRequest): Promise<JsonValue>;
  deleteLightingGroup(groupId: string): Promise<JsonValue>;
  createLightingFixture(request: LightingFixtureCreateRequest): Promise<JsonValue>;
  createLightingScene(request: LightingSceneCreateRequest): Promise<JsonValue>;
  updateLightingScene(request: LightingSceneUpdateRequest): Promise<JsonValue>;
  deleteLightingScene(sceneId: string): Promise<JsonValue>;
  reorderLightingScene(sceneId: string, beforeSceneId: string | null): Promise<JsonValue>;
  pinLightingScene(sceneId: string, pinned: boolean): Promise<JsonValue>;
  updateLightingFixture(request: LightingFixtureUpdateRequest): Promise<JsonValue>;
  identifyLightingFixture(fixtureId: string, durationMs?: number): Promise<JsonValue>;
  highlightLightingFixtures(fixtureIds: readonly string[], mode: "highlight" | "solo" | "off"): Promise<JsonValue>;
  startLightingIdentifySequence(fixtureIds: readonly string[], stepMs: number, durationMs: number): Promise<JsonValue>;
  clearLightingIdentifyBursts(): Promise<JsonValue>;
  deleteLightingFixture(fixtureId: string): Promise<JsonValue>;
  setLightingGroupPower(groupId: string, on: boolean): Promise<JsonValue>;
  setLightingAllPower(on: boolean): Promise<JsonValue>;
  recallLightingScene(sceneId: string, fadeDurationSeconds?: number): Promise<JsonValue>;
  seedPlanningDemo(replaceExistingData?: boolean): Promise<JsonValue>;
  createPlanningProject(request: PlanningProjectCreateRequest): Promise<JsonValue>;
  reorderPlanningProject(request: PlanningProjectReorderRequest): Promise<JsonValue>;
  createPlanningTask(request: PlanningTaskCreateRequest): Promise<JsonValue>;
  addPlanningChecklistItem(taskId: string, text: string): Promise<JsonValue>;
  setPlanningChecklistItemDone(taskId: string, itemId: string, done: boolean): Promise<JsonValue>;
  readPlanningTimeReport(projectId?: string): Promise<JsonValue>;
  updatePlanningSettings(request: PlanningSettingsUpdateRequest): Promise<JsonValue>;
  reschedulePlanningTask(request: PlanningTaskRescheduleRequest): Promise<JsonValue>;
  togglePlanningTaskComplete(taskId: string): Promise<JsonValue>;
  exportSupportBackup(): Promise<JsonValue>;
  restoreSupportBackup(path: string): Promise<JsonValue>;
  exportCompanionConfig(baseUrl?: string): Promise<JsonValue>;
  subscribe(listener: () => void): () => void;
  dispose(): Promise<void>;
}
