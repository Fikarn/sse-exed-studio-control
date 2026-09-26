import type {
  AudioChannelSnapshot,
  AudioDynamicsSnapshot,
  AudioEqSnapshot,
  AudioMixTargetSnapshot,
  AudioSceneSnapshot,
  AudioSendModeSnapshot,
  AudioSnapshot,
  LightingDmxChannelSnapshot,
  LightingDmxMonitorSnapshot,
  LightingFixtureSnapshot,
  LightingSceneFixtureSnapshot,
  LightingSceneSnapshot,
  LightingSnapshot,
  ShellState,
} from "@sse/engine-client";
// Runtime import through the asset-free subpath: the specs that import app
// source through Playwright cannot load the package index (it carries the
// crest PNG), so the shared tone map is reached without it.
import { toneForSubsystem } from "@sse/design-system/statusTone";

export type StatusToneLike = "attention" | "error" | "info" | "ok";

// Loose snapshot type for the snapshots that the engine still assembles
// ad-hoc as serde_json::Value (commissioning, support, app, control
// surface, health). Tightening these requires restructuring the engine
// boundary; tracked separately.
export type SnapshotRecord = Record<string, unknown>;

export interface CommissioningCheck {
  checkedAt?: string;
  detail: string;
  id: string;
  label: string;
  status: StatusToneLike;
}

// 2026-09 production readiness, Slice 7 (F20): a backup is a JSON support
// archive or a whole database backup; the engine says which.
export type SupportBackupKind = "archive" | "database";

export interface SupportBackupEntry {
  kind: SupportBackupKind;
  modifiedAt: number;
  name: string;
  path: string;
  sizeBytes: number;
}

export function describeBackupKind(kind: SupportBackupKind) {
  return kind === "database" ? "database backup" : "backup archive";
}

// New pages program, Slice 2 (D3): a restore's reply carries `detail` only when
// the backup held something the hardware link did not restore — the Planning
// data of a backup written before Planning left. It follows the shell's own
// sentence, so the operator reads what was left out.
export function withRestoreDetail(message: string, result: Record<string, unknown> | null) {
  const detail = typeof result?.detail === "string" ? result.detail.trim() : "";
  return detail ? `${message} ${detail}` : message;
}

function backupKindOf(record: Record<string, unknown>, name: string): SupportBackupKind {
  if (record.kind === "database" || record.kind === "archive") {
    return record.kind;
  }
  return name.endsWith(".sqlite3") ? "database" : "archive";
}

// UI-domain shapes. They are derived from the engine snapshots via the
// helpers below. Keeping them as separate types lets the consuming UI
// rely on `field?: T` (undefined) semantics where the wire format uses
// `field: T | null` — the helpers are responsible for that null→undefined
// adapter so call sites never see a `null`.
export interface LightingFixtureEntry {
  beamAngleDegrees?: number;
  cct: number;
  controlValues: Record<string, number>;
  definitionId: string;
  dmxStartAddress: number;
  groupId?: string;
  id: string;
  intensity: number;
  kind: string;
  modeId: string;
  name: string;
  on: boolean;
  rigZ?: number;
  spatialRotation: number;
  spatialX?: number;
  spatialY?: number;
  type: string;
  universe: number;
}

export interface LightingSceneFixtureEntry {
  cct: number;
  controlValues: Record<string, number>;
  fixtureId: string;
  intensity: number;
  on: boolean;
}

export interface LightingSceneEntry {
  fixtureCount: number;
  fixtureStates: LightingSceneFixtureEntry[];
  id: string;
  lastRecalled: boolean;
  lastRecalledAt?: string;
  fadeDurationMs?: number;
  fadeProgress?: number;
  name: string;
}

export interface LightingGroupEntry {
  fixtureCount: number;
  id: string;
  name: string;
}

export interface LightingDmxChannelEntry {
  channel: number;
  label: string;
  lightName: string;
  universe: number;
  value: number;
}

export interface AudioChannelEntry {
  autoSet: boolean;
  clip: boolean;
  fader: number;
  gain: number;
  id: string;
  instrument: boolean;
  meterLeft: number;
  meterLevel: number;
  meterRight: number;
  mixLevels: Record<string, number>;
  mute: boolean;
  name: string;
  pad: boolean;
  peakHold: number;
  peakHoldLeft: number;
  peakHoldRight: number;
  phase: boolean;
  phantom: boolean;
  role: string;
  shortName: string;
  solo: boolean;
  stereo: boolean;
  eq: AudioEqSnapshot;
  dynamics: AudioDynamicsSnapshot;
  sendModes: Record<string, AudioSendModeSnapshot>;
}

export interface AudioMixTargetEntry {
  dim: boolean;
  id: string;
  meterLeft: number;
  meterLevel: number;
  meterRight: number;
  mono: boolean;
  mute: boolean;
  name: string;
  peakHold: number;
  peakHoldLeft: number;
  peakHoldRight: number;
  role: string;
  shortName: string;
  talkback: boolean;
  volume: number;
}

export interface AudioSnapshotEntry {
  contents?: AudioSceneSnapshot["contents"];
  id: string;
  lastRecalled: boolean;
  lastRecalledAt?: string;
  name: string;
  order: number;
  oscIndex: number;
  preview: AudioSceneSnapshot["preview"];
}

// Coercion helpers retained only for the loose JsonObject snapshots
// (commissioning, support). Once those snapshots become typed the
// asRecord/asStatusTone calls below disappear.
export function asRecord(value: unknown): SnapshotRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as SnapshotRecord) : null;
}

export function asStatusTone(value: unknown, fallback: StatusToneLike = "info"): StatusToneLike {
  return value === "ok" || value === "attention" || value === "error" || value === "info" ? value : fallback;
}

// Human-readable label for a StatusToneLike enum, so the raw machine token
// (`ok`/`attention`/`error`/`info`) never reaches operator-facing badge/pill
// text (COPY-04 / COPY-09).
export function statusToneLabel(status: StatusToneLike): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "attention":
      return "Needs attention";
    case "error":
      return "Failed";
    default:
      return "Pending";
  }
}

export function formatLifecycleLabel(lifecycle: ShellState["lifecycle"]) {
  switch (lifecycle) {
    case "launching-process":
      return "Starting up";
    case "waiting-for-ready-event":
      return "Waiting for Studio Control to answer";
    case "waiting-for-health-snapshot":
      return "Loading the health checks";
    case "waiting-for-app-snapshot":
      return "Loading workspaces";
    case "ready":
      return "Ready";
    case "failed":
      return "Startup failed";
    default:
      return "Initializing";
  }
}

export function formatBackupTimestamp(value: string | number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function getCommissioningChecks(snapshot: SnapshotRecord | null): CommissioningCheck[] {
  const checks = snapshot?.checks;
  if (!Array.isArray(checks)) {
    return [];
  }

  return checks.flatMap((check) => {
    const record = asRecord(check);
    if (!record) {
      return [];
    }

    return [
      {
        checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
        detail: String(record.detail ?? record.message ?? "Pending"),
        id: String(record.id ?? record.label ?? "check"),
        label: String(record.label ?? "Status"),
        status: asStatusTone(
          record.status === "passed" ? "ok" : record.status === "failed" ? "attention" : record.status,
          "attention"
        ),
      },
    ];
  });
}

export function getSupportBackups(snapshot: SnapshotRecord | null): SupportBackupEntry[] {
  const backups = snapshot?.backups;
  if (Array.isArray(backups) && backups.length > 0) {
    return backups.flatMap((backup) => {
      const record = asRecord(backup);
      if (!record) {
        return [];
      }

      const name = String(record.name ?? "support-backup.json");
      return [
        {
          kind: backupKindOf(record, name),
          modifiedAt:
            typeof record.modifiedAt === "number" ? record.modifiedAt : Date.parse(String(record.modifiedAt ?? "")),
          name,
          path: String(record.path ?? ""),
          sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
        },
      ];
    });
  }

  const recentBackups = snapshot?.recentBackups;
  if (!Array.isArray(recentBackups)) {
    return [];
  }

  return recentBackups.flatMap((backup, index) => {
    if (typeof backup !== "string") {
      return [];
    }

    return [
      {
        kind: "archive",
        modifiedAt: Date.parse(backup),
        name: `fixture-backup-${index + 1}.json`,
        path: backup,
        sizeBytes: 0,
      },
    ];
  });
}

// Lighting helpers: thin null→undefined adapters over the typed snapshot.
export function getLightingFixtures(snapshot: LightingSnapshot | null): LightingFixtureEntry[] {
  return (snapshot?.fixtures ?? []).map((f: LightingFixtureSnapshot) => ({
    beamAngleDegrees: f.beamAngleDegrees ?? undefined,
    cct: f.cct,
    controlValues: f.controlValues,
    definitionId: f.definitionId,
    dmxStartAddress: f.dmxStartAddress,
    groupId: f.groupId ?? undefined,
    id: f.id,
    intensity: f.intensity,
    kind: f.kind,
    modeId: f.modeId,
    name: f.name,
    on: f.on,
    rigZ: f.rigZ ?? undefined,
    spatialRotation: f.spatialRotation,
    spatialX: f.spatialX ?? undefined,
    spatialY: f.spatialY ?? undefined,
    type: f.type,
    universe: f.universe,
  }));
}

export function getLightingScenes(snapshot: LightingSnapshot | null): LightingSceneEntry[] {
  return (snapshot?.scenes ?? []).map((s: LightingSceneSnapshot) => ({
    fixtureCount: s.fixtureCount,
    fixtureStates: s.fixtureStates.map((entry: LightingSceneFixtureSnapshot): LightingSceneFixtureEntry => ({
      cct: entry.cct,
      controlValues: entry.controlValues,
      fixtureId: entry.fixtureId,
      intensity: entry.intensity,
      on: entry.on,
    })),
    id: s.id,
    lastRecalled: s.lastRecalled,
    lastRecalledAt: s.lastRecalledAt ?? undefined,
    fadeDurationMs: s.fadeDurationMs ?? undefined,
    fadeProgress: s.fadeProgress ?? undefined,
    name: s.name,
  }));
}

export function getLightingDmxChannels(snapshot: LightingDmxMonitorSnapshot | null): LightingDmxChannelEntry[] {
  return [...(snapshot?.channels ?? [])]
    .map((c: LightingDmxChannelSnapshot): LightingDmxChannelEntry => ({
      channel: c.channel,
      label: c.label,
      lightName: c.lightName,
      universe: c.universe,
      value: c.value,
    }))
    .sort((left, right) => {
      const universeDelta = left.universe - right.universe;
      return universeDelta !== 0 ? universeDelta : left.channel - right.channel;
    });
}

// Scene thumbnails persist on the engine-managed shell.lighting.sceneThumbs
// blob (added in PR 3 §3.3 — extends shell_settings.rs). The map is full-
// replace: callers read the current map, mutate locally, and call
// store.setLightingSceneThumbs(updated). Per LightingSceneSnapshot being
// ts-rs strict (Phase 0 V5), the engine treats each value as opaque and
// the frontend owns rendering / serialization.
export function getSceneThumbs(appSnapshot: SnapshotRecord | null): Record<string, string> {
  const shell = asRecord(appSnapshot?.shell);
  const lighting = asRecord(shell?.lighting);
  const thumbs = asRecord(lighting?.sceneThumbs);
  if (!thumbs) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [sceneId, value] of Object.entries(thumbs)) {
    if (typeof value === "string") {
      result[sceneId] = value;
    }
  }
  return result;
}

export function getSceneThumb(appSnapshot: SnapshotRecord | null, sceneId: string): string | undefined {
  return getSceneThumbs(appSnapshot)[sceneId];
}

// Audio helpers: thin pass-throughs over typed snapshot.
export function getAudioChannels(snapshot: AudioSnapshot | null): AudioChannelEntry[] {
  return (snapshot?.channels ?? []).map((c: AudioChannelSnapshot) => ({
    autoSet: c.autoSet,
    clip: c.clip,
    fader: c.fader,
    gain: c.gain,
    id: c.id,
    instrument: c.instrument,
    meterLeft: c.meterLeft,
    meterLevel: c.meterLevel,
    meterRight: c.meterRight,
    mixLevels: { ...c.mixLevels },
    mute: c.mute,
    name: c.name,
    pad: c.pad,
    peakHold: c.peakHold,
    peakHoldLeft: c.peakHoldLeft,
    peakHoldRight: c.peakHoldRight,
    phase: c.phase,
    phantom: c.phantom,
    role: c.role,
    shortName: c.shortName,
    solo: c.solo,
    stereo: c.stereo,
    eq: c.eq,
    dynamics: c.dynamics,
    sendModes: { ...c.sendModes },
  }));
}

export function getAudioMixTargets(snapshot: AudioSnapshot | null): AudioMixTargetEntry[] {
  return (snapshot?.mixTargets ?? []).map((m: AudioMixTargetSnapshot) => ({
    dim: m.dim,
    id: m.id,
    meterLeft: m.meterLeft,
    meterLevel: m.meterLevel,
    meterRight: m.meterRight,
    mono: m.mono,
    mute: m.mute,
    name: m.name,
    peakHold: m.peakHold,
    peakHoldLeft: m.peakHoldLeft,
    peakHoldRight: m.peakHoldRight,
    role: m.role,
    shortName: m.shortName,
    talkback: m.talkback,
    volume: m.volume,
  }));
}

export function getAudioSnapshots(snapshot: AudioSnapshot | null): AudioSnapshotEntry[] {
  return [...(snapshot?.snapshots ?? [])]
    .map((s: AudioSceneSnapshot): AudioSnapshotEntry => ({
      id: s.id,
      contents: s.contents ?? undefined,
      lastRecalled: s.lastRecalled,
      lastRecalledAt: s.lastRecalledAt ?? undefined,
      name: s.name,
      order: s.order,
      oscIndex: s.oscIndex,
      preview: s.preview,
    }))
    .sort((left, right) => left.order - right.order);
}

// Map the long engine summary to a short status word for the shell header
// monitor control (e.g. "ready", "pending", "passed"). The per-item summary
// belongs in the workspace's own health bar, not the global header.
function statusLabelFor(check: { status?: string } | undefined, fallback: string): string {
  switch (check?.status) {
    case "passed":
      return "ready";
    case "failed":
      return "failed";
    case "ok":
      // Slice 8 (system §9): one word per state — "passed" and "ok" are the
      // same healthy subsystem, and the header said them two different ways.
      return "ready";
    case "ready":
      // The hardware link's own words (see `healthCheckTone`).
      return "ready";
    case "not-verified":
      return "not verified";
    case "unconfigured":
      return "not set up";
    case "disabled":
    case "unavailable":
      return check.status;
    case "info":
    case "idle":
    case "attention":
    case "error":
      return check.status;
    default:
      return fallback;
  }
}

/** The tone of a health check in the header. The hardware link reports its
 *  subsystems in words of its own — audio and lighting `ready` /
 *  `not-verified` / `attention` (lighting also `unconfigured` / `disabled`),
 *  the Stream Deck bridge `ready` / `unavailable`. Until 2026-09-21 only the
 *  fixture double's `ok` / `attention` were mapped, so on the workstation a
 *  healthy Audio, Lighting and Deck all read as a yellow "pending"; the double
 *  has said the hardware link's words since 2026-09-22, and the older two
 *  still map as they did. */
export function healthCheckTone(status: unknown): StatusToneLike {
  switch (status) {
    case "ready":
    case "passed":
      return "ok";
    case "not-verified":
    case "unconfigured":
    case "disabled":
      return "attention";
    case "unavailable":
      return "error";
    default:
      return asStatusTone(status, "attention");
  }
}

/** GLO-09: cross-workspace latched state that deserves a persistent chip in
 *  the shell monitor strip (previously only the async leave-prompt guarded
 *  it). Both flags derive from engine snapshots, so the chips stay truthful
 *  across workspace switches. */
export interface LatchedShellState {
  lightingSceneDrift: boolean;
  audioSolo: boolean;
}

/** Visual overhaul A, Slice 2 (plan D1, finding C3): what each workspace
 *  currently shows as its own state — the Console's badge, the rig's bridge
 *  state — so the header lamp mirrors the worst of the engine's health check
 *  and the workspace's state, with the workspace's word when it is the
 *  worse one. */
export interface WorkspaceStateTone {
  tone: StatusToneLike;
  word: string;
  /** 2026-09 production readiness, Slice 11: the word also wins when the health
   *  check is at the same tone. Held light outputs are `attention`, like a probe
   *  that has not been run — but held means nothing reaches the rig at all, and
   *  it is a state the operator chose and has to remember to undo. */
  winsTies?: boolean;
}

export interface WorkspaceStateTones {
  audio?: WorkspaceStateTone | null;
  lighting?: WorkspaceStateTone | null;
}

const TONE_RANK: Record<StatusToneLike, number> = { error: 3, attention: 2, info: 1, ok: 0 };

/** What the Lighting workspace shows as its own state, for the header lamp:
 *  no bridge, then held light outputs (Slice 11 — only an explicit `false` is a
 *  hold, as on the hardware link, and it outranks an unsaved scene because
 *  nothing reaches the rig at all), then an unsaved scene. */
export function deriveLightingWorkspaceTone(
  lightingSnapshot: { outputArmed?: boolean; reachable?: boolean } | null | undefined,
  sceneDrift: boolean
): WorkspaceStateTone | null {
  if (lightingSnapshot?.reachable === false) {
    return { tone: "error", word: "no bridge" };
  }
  if (lightingSnapshot?.outputArmed === false) {
    return { tone: "attention", winsTies: true, word: "held" };
  }
  return sceneDrift ? { tone: "attention", word: "unsaved" } : null;
}

export function buildMonitorItems(
  healthSnapshot: SnapshotRecord | null,
  latched?: LatchedShellState,
  workspaceTones?: WorkspaceStateTones
) {
  const checks =
    healthSnapshot && typeof healthSnapshot.checks === "object" && healthSnapshot.checks
      ? (healthSnapshot.checks as Record<string, { status?: string; summary?: string }>)
      : {};

  const lamp = (
    id: "lighting" | "audio",
    label: string,
    check: { status?: string } | undefined,
    workspace: WorkspaceStateTone | null | undefined
  ) => {
    const health = healthCheckTone(check?.status);
    const tone = toneForSubsystem(health, workspace?.tone ?? null) as StatusToneLike;
    const workspaceWorse = workspace
      ? TONE_RANK[workspace.tone] > TONE_RANK[health] ||
        (workspace.winsTies === true && TONE_RANK[workspace.tone] === TONE_RANK[health])
      : false;
    return {
      id,
      label,
      detail: workspaceWorse && workspace ? workspace.word : statusLabelFor(check, "pending"),
      status: tone,
    };
  };
  const items = [
    lamp("lighting", "Lighting", checks.lighting, workspaceTones?.lighting),
    lamp("audio", "Audio", checks.audio, workspaceTones?.audio),
    {
      id: "surface",
      label: "Deck",
      detail: statusLabelFor(checks.controlSurface, "pending"),
      // Why: previously fell back to "info" (blue) while sibling subsystems
      // (lighting, audio) fell back to "attention" — that asymmetry rendered
      // Surface's pending dot blue and the others yellow on the same page,
      // even though all three were semantically "pending". Aligning on
      // "attention" makes the three pills agree on tone for the same state.
      status: healthCheckTone(checks.controlSurface?.status),
    },
  ] as Array<{
    id: string;
    label: string;
    detail: string;
    status: "ok" | "attention" | "error" | "info";
    target?: string;
  }>;

  if (latched?.lightingSceneDrift) {
    items.push({
      id: "latched:scene-drift",
      label: "Scene drift",
      detail: "unsaved",
      status: "attention",
      target: "Lighting",
    });
  }
  if (latched?.audioSolo) {
    items.push({
      id: "latched:solo",
      label: "Solo",
      detail: "latched",
      status: "attention",
      target: "Audio",
    });
  }

  return items;
}
