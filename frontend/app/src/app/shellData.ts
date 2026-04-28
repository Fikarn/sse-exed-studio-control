import type {
  AudioChannelSnapshot,
  AudioMixTargetSnapshot,
  AudioSceneSnapshot,
  AudioSnapshot,
  LightingDmxChannelSnapshot,
  LightingDmxMonitorSnapshot,
  LightingFixtureSnapshot,
  LightingGroupSnapshot,
  LightingSceneFixtureSnapshot,
  LightingSceneSnapshot,
  LightingSnapshot,
  PlanningActivityEntry as PlanningActivitySnapshot,
  PlanningChecklistItem as PlanningChecklistSnapshot,
  PlanningCounts,
  PlanningProject as PlanningProjectSnapshot,
  PlanningSettingsSnapshot,
  PlanningSnapshot,
  PlanningTask as PlanningTaskSnapshot,
  ShellState,
} from "@sse/engine-client";
import type { StatusTone } from "@sse/design-system";

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

export interface SupportBackupEntry {
  modifiedAt: number;
  name: string;
  path: string;
  sizeBytes: number;
}

// UI-domain shapes. They are derived from the engine snapshots via the
// helpers below. Keeping them as separate types lets the consuming UI
// rely on `field?: T` (undefined) semantics where the wire format uses
// `field: T | null` — the helpers are responsible for that null→undefined
// adapter so call sites never see a `null`.
export interface LightingFixtureEntry {
  beamAngleDegrees?: number;
  cct: number;
  dmxStartAddress: number;
  groupId?: string;
  id: string;
  intensity: number;
  kind: string;
  name: string;
  on: boolean;
  rigZ?: number;
  spatialRotation: number;
  spatialX?: number;
  spatialY?: number;
  type: string;
}

export interface LightingSceneFixtureEntry {
  cct: number;
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
  phase: boolean;
  phantom: boolean;
  role: string;
  shortName: string;
  solo: boolean;
  stereo: boolean;
}

export interface AudioMixTargetEntry {
  dim: boolean;
  id: string;
  mono: boolean;
  mute: boolean;
  name: string;
  role: string;
  shortName: string;
  talkback: boolean;
  volume: number;
}

export interface AudioSnapshotEntry {
  id: string;
  lastRecalled: boolean;
  lastRecalledAt?: string;
  name: string;
  order: number;
  oscIndex: number;
}

export interface PlanningProjectEntry {
  description: string;
  id: string;
  lastUpdated?: string;
  order: number;
  priority: string;
  status: string;
  title: string;
}

export interface PlanningChecklistEntry {
  done: boolean;
  id: string;
  text: string;
}

export interface PlanningTaskEntry {
  checklist: PlanningChecklistEntry[];
  completed: boolean;
  createdAt?: string;
  description: string;
  dueDate?: string;
  id: string;
  isRunning: boolean;
  labels: string[];
  lastStarted?: string;
  order: number;
  priority: string;
  projectId: string;
  scheduledDurationSeconds?: number;
  scheduledStart?: string;
  title: string;
  totalSeconds: number;
}

export interface PlanningActivityEntry {
  action: string;
  detail: string;
  entityId: string;
  entityType: string;
  id: string;
  timestamp?: string;
}

export interface PlanningSettingsEntry {
  dashboardView: string;
  deckMode: string;
  modeSection: "board" | "timeline";
  selectedProjectId?: string;
  selectedTaskId?: string;
  sortBy: string;
  timelineEndHour: number;
  timelineStartHour: number;
  viewFilter: string;
}

export interface PlanningCountsEntry {
  completedTaskCount: number;
  projectCount: number;
  runningTaskCount: number;
  taskCount: number;
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

export function mapStatusBadgeTone(status: StatusToneLike): StatusTone {
  switch (status) {
    case "ok":
      return "healthy";
    case "attention":
      return "warning";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function formatLifecycleLabel(lifecycle: ShellState["lifecycle"]) {
  switch (lifecycle) {
    case "launching-process":
      return "Launching process";
    case "waiting-for-ready-event":
      return "Awaiting ready event";
    case "waiting-for-health-snapshot":
      return "Loading health snapshot";
    case "waiting-for-app-snapshot":
      return "Loading app snapshot";
    case "ready":
      return "Shell ready";
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

      return [
        {
          modifiedAt:
            typeof record.modifiedAt === "number" ? record.modifiedAt : Date.parse(String(record.modifiedAt ?? "")),
          name: String(record.name ?? "support-backup.json"),
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
    dmxStartAddress: f.dmxStartAddress,
    groupId: f.groupId ?? undefined,
    id: f.id,
    intensity: f.intensity,
    kind: f.kind,
    name: f.name,
    on: f.on,
    rigZ: f.rigZ ?? undefined,
    spatialRotation: f.spatialRotation,
    spatialX: f.spatialX ?? undefined,
    spatialY: f.spatialY ?? undefined,
    type: f.type,
  }));
}

export function getLightingScenes(snapshot: LightingSnapshot | null): LightingSceneEntry[] {
  return (snapshot?.scenes ?? []).map((s: LightingSceneSnapshot) => ({
    fixtureCount: s.fixtureCount,
    fixtureStates: s.fixtureStates.map(
      (entry: LightingSceneFixtureSnapshot): LightingSceneFixtureEntry => ({
        cct: entry.cct,
        fixtureId: entry.fixtureId,
        intensity: entry.intensity,
        on: entry.on,
      })
    ),
    id: s.id,
    lastRecalled: s.lastRecalled,
    lastRecalledAt: s.lastRecalledAt ?? undefined,
    name: s.name,
  }));
}

export function getLightingGroups(snapshot: LightingSnapshot | null): LightingGroupEntry[] {
  return (snapshot?.groups ?? []).map((g: LightingGroupSnapshot) => ({
    fixtureCount: g.fixtureCount,
    id: g.id,
    name: g.name,
  }));
}

export function getLightingDmxChannels(snapshot: LightingDmxMonitorSnapshot | null): LightingDmxChannelEntry[] {
  return [...(snapshot?.channels ?? [])]
    .map(
      (c: LightingDmxChannelSnapshot): LightingDmxChannelEntry => ({
        channel: c.channel,
        label: c.label,
        lightName: c.lightName,
        value: c.value,
      })
    )
    .sort((left, right) => left.channel - right.channel);
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
    phase: c.phase,
    phantom: c.phantom,
    role: c.role,
    shortName: c.shortName,
    solo: c.solo,
    stereo: c.stereo,
  }));
}

export function getAudioMixTargets(snapshot: AudioSnapshot | null): AudioMixTargetEntry[] {
  return (snapshot?.mixTargets ?? []).map((m: AudioMixTargetSnapshot) => ({
    dim: m.dim,
    id: m.id,
    mono: m.mono,
    mute: m.mute,
    name: m.name,
    role: m.role,
    shortName: m.shortName,
    talkback: m.talkback,
    volume: m.volume,
  }));
}

export function getAudioSnapshots(snapshot: AudioSnapshot | null): AudioSnapshotEntry[] {
  return [...(snapshot?.snapshots ?? [])]
    .map(
      (s: AudioSceneSnapshot): AudioSnapshotEntry => ({
        id: s.id,
        lastRecalled: s.lastRecalled,
        lastRecalledAt: s.lastRecalledAt ?? undefined,
        name: s.name,
        order: s.order,
        oscIndex: s.oscIndex,
      })
    )
    .sort((left, right) => left.order - right.order);
}

// Planning helpers: thin pass-throughs over typed snapshot.
export function getPlanningProjects(snapshot: PlanningSnapshot | null): PlanningProjectEntry[] {
  return [...(snapshot?.projects ?? [])]
    .map(
      (p: PlanningProjectSnapshot): PlanningProjectEntry => ({
        description: p.description,
        id: p.id,
        lastUpdated: p.lastUpdated || undefined,
        order: p.order,
        priority: p.priority,
        status: p.status,
        title: p.title,
      })
    )
    .sort((left, right) => left.order - right.order);
}

export function getPlanningTasks(snapshot: PlanningSnapshot | null): PlanningTaskEntry[] {
  return [...(snapshot?.tasks ?? [])]
    .map(
      (t: PlanningTaskSnapshot): PlanningTaskEntry => ({
        checklist: t.checklist.map(
          (item: PlanningChecklistSnapshot): PlanningChecklistEntry => ({
            done: item.done,
            id: item.id,
            text: item.text,
          })
        ),
        completed: t.completed,
        createdAt: t.createdAt || undefined,
        description: t.description,
        dueDate: t.dueDate ?? undefined,
        id: t.id,
        isRunning: t.isRunning,
        labels: [...t.labels],
        lastStarted: t.lastStarted ?? undefined,
        order: t.order,
        priority: t.priority,
        projectId: t.projectId,
        scheduledDurationSeconds: t.scheduledDurationSeconds ?? undefined,
        scheduledStart: t.scheduledStart ?? undefined,
        title: t.title,
        totalSeconds: t.totalSeconds,
      })
    )
    .sort((left, right) => left.order - right.order);
}

export function getPlanningActivityLog(snapshot: PlanningSnapshot | null): PlanningActivityEntry[] {
  return [...(snapshot?.activityLog ?? [])]
    .map(
      (a: PlanningActivitySnapshot): PlanningActivityEntry => ({
        action: a.action,
        detail: a.detail,
        entityId: a.entityId,
        entityType: a.entityType,
        id: a.id,
        timestamp: a.timestamp || undefined,
      })
    )
    .sort((left, right) => {
      const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
      const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
      return rightTime - leftTime;
    });
}

export function getPlanningSettings(snapshot: PlanningSnapshot | null): PlanningSettingsEntry {
  const settings: PlanningSettingsSnapshot | null = snapshot?.settings ?? null;
  return {
    dashboardView: settings?.dashboardView ?? "kanban",
    deckMode: settings?.deckMode ?? "project",
    modeSection: settings?.modeSection === "board" ? "board" : "timeline",
    selectedProjectId: settings?.selectedProjectId ?? undefined,
    selectedTaskId: settings?.selectedTaskId ?? undefined,
    sortBy: settings?.sortBy ?? "manual",
    timelineEndHour: settings?.timelineEndHour ?? 22,
    timelineStartHour: settings?.timelineStartHour ?? 9,
    viewFilter: settings?.viewFilter ?? "all",
  };
}

export function getPlanningCounts(snapshot: PlanningSnapshot | null): PlanningCountsEntry {
  const counts: PlanningCounts | null = snapshot?.counts ?? null;
  return {
    completedTaskCount: counts?.completedTaskCount ?? 0,
    projectCount: counts?.projectCount ?? 0,
    runningTaskCount: counts?.runningTaskCount ?? 0,
    taskCount: counts?.taskCount ?? 0,
  };
}

export function buildMonitorItems(healthSnapshot: SnapshotRecord | null) {
  const checks =
    healthSnapshot && typeof healthSnapshot.checks === "object" && healthSnapshot.checks
      ? (healthSnapshot.checks as Record<string, { status?: string; summary?: string }>)
      : {};

  return [
    {
      label: checks.lighting?.summary ?? "Lighting state pending",
      status: asStatusTone(checks.lighting?.status, "attention"),
    },
    {
      label: checks.audio?.summary ?? "Audio state pending",
      status: asStatusTone(checks.audio?.status, "attention"),
    },
    {
      label: checks.controlSurface?.summary ?? "Control surface pending",
      status: asStatusTone(checks.controlSurface?.status, "info"),
    },
  ] as const;
}

export function buildContextSections(
  activeWorkspace: ShellState["activeWorkspace"],
  commissioningSnapshot: SnapshotRecord | null,
  supportSnapshot: SnapshotRecord | null,
  lightingSnapshot: LightingSnapshot | null
) {
  if (activeWorkspace === "lighting") {
    const fixtures = getLightingFixtures(lightingSnapshot);
    const scenes = getLightingScenes(lightingSnapshot);
    const groups = getLightingGroups(lightingSnapshot);
    const selectedFixtureId = lightingSnapshot?.selectedFixtureId ?? null;
    const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
    const onCount = fixtures.filter((fixture) => fixture.on === true).length;

    return [
      {
        title: "Lighting status",
        items: [
          {
            id: "lighting:summary",
            label: lightingSnapshot?.summary ?? "Awaiting lighting snapshot.",
          },
          {
            id: "lighting:transport",
            label: `Bridge ${lightingSnapshot?.bridgeIp ?? "unconfigured"} · Universe ${lightingSnapshot?.universe ?? 1}`,
          },
          {
            id: "lighting:adapter",
            label: `Adapter ${lightingSnapshot?.adapterMode ?? "unknown"}`,
          },
        ],
      },
      {
        title: "Lighting context",
        items: [
          {
            id: "lighting:fixtures",
            label: `Fixtures on ${onCount} / ${fixtures.length}`,
          },
          {
            id: "lighting:inventory",
            label: `Scenes ${scenes.length} · Groups ${groups.length}`,
          },
          {
            id: "lighting:selection",
            label: selectedFixture ? `Selected fixture ${selectedFixture.name}` : "No fixture selected.",
          },
        ],
      },
    ];
  }

  const checks = getCommissioningChecks(commissioningSnapshot);
  const backups = getSupportBackups(supportSnapshot);

  return [
    {
      title: activeWorkspace === "setup" ? "Runner Status" : "Operator Context",
      items:
        checks.length > 0
          ? checks.map((check) => ({
              id: `check:${check.id}`,
              label: `${check.label}: ${check.detail}`,
            }))
          : [{ id: "check:empty", label: "Awaiting commissioning data." }],
    },
    {
      title: "Support",
      items:
        backups.length > 0
          ? backups.slice(0, 3).map((backup, index) => ({
              id: `backup:${backup.path || backup.modifiedAt || index}`,
              label: `Backup: ${formatBackupTimestamp(backup.modifiedAt)}`,
            }))
          : [
              {
                id: "backup:empty",
                label: String(supportSnapshot?.summary ?? "No support exports yet."),
              },
            ],
    },
  ];
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}
