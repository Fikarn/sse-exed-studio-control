import type { ShellState } from "@sse/engine-client";
import type { StatusTone } from "@sse/design-system";

export type StatusToneLike = "attention" | "error" | "info" | "ok";
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

export interface LightingCueEntry {
  fadeInMs: number;
  fadeOutMs: number;
  followSeconds?: number;
  id: string;
  label: string;
  notes?: string;
  ordinal: number;
  sceneId?: string;
  state: string;
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

export function getLightingFixtures(snapshot: SnapshotRecord | null): LightingFixtureEntry[] {
  const fixtures = snapshot?.fixtures;
  if (!Array.isArray(fixtures)) {
    return [];
  }

  return fixtures.flatMap((fixture) => {
    const record = asRecord(fixture);
    if (!record) {
      return [];
    }

    return [
      {
        beamAngleDegrees: typeof record.beamAngleDegrees === "number" ? record.beamAngleDegrees : undefined,
        cct: typeof record.cct === "number" ? record.cct : 3200,
        dmxStartAddress: typeof record.dmxStartAddress === "number" ? record.dmxStartAddress : 1,
        groupId: typeof record.groupId === "string" ? record.groupId : undefined,
        id: String(record.id ?? "fixture"),
        intensity: typeof record.intensity === "number" ? record.intensity : 0,
        kind: String(record.kind ?? "fixture"),
        name: String(record.name ?? record.id ?? "Fixture"),
        on: record.on === true,
        rigZ: typeof record.rigZ === "number" ? record.rigZ : undefined,
        spatialRotation: typeof record.spatialRotation === "number" ? record.spatialRotation : 0,
        spatialX: typeof record.spatialX === "number" ? record.spatialX : undefined,
        spatialY: typeof record.spatialY === "number" ? record.spatialY : undefined,
        type: String(record.type ?? record.kind ?? "Fixture"),
      },
    ];
  });
}

export function getLightingScenes(snapshot: SnapshotRecord | null): LightingSceneEntry[] {
  const scenes = snapshot?.scenes;
  if (!Array.isArray(scenes)) {
    return [];
  }

  return scenes.flatMap((scene) => {
    const record = asRecord(scene);
    if (!record) {
      return [];
    }

    const fixtureStates = Array.isArray(record.fixtureStates)
      ? record.fixtureStates.flatMap((fixtureState) => {
          const fixtureRecord = asRecord(fixtureState);
          if (!fixtureRecord) {
            return [];
          }

          return [
            {
              cct: typeof fixtureRecord.cct === "number" ? fixtureRecord.cct : 3200,
              fixtureId: String(fixtureRecord.fixtureId ?? "fixture"),
              intensity: typeof fixtureRecord.intensity === "number" ? fixtureRecord.intensity : 0,
              on: fixtureRecord.on === true,
            },
          ];
        })
      : [];

    return [
      {
        fixtureCount: typeof record.fixtureCount === "number" ? record.fixtureCount : fixtureStates.length,
        fixtureStates,
        id: String(record.id ?? "scene"),
        lastRecalled: record.lastRecalled === true,
        lastRecalledAt: typeof record.lastRecalledAt === "string" ? record.lastRecalledAt : undefined,
        name: String(record.name ?? record.id ?? "Scene"),
      },
    ];
  });
}

export function getLightingGroups(snapshot: SnapshotRecord | null): LightingGroupEntry[] {
  const groups = snapshot?.groups;
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups.flatMap((group) => {
    const record = asRecord(group);
    if (!record) {
      return [];
    }

    return [
      {
        fixtureCount: typeof record.fixtureCount === "number" ? record.fixtureCount : 0,
        id: String(record.id ?? "group"),
        name: String(record.name ?? record.id ?? "Group"),
      },
    ];
  });
}

export function getLightingCues(snapshot: SnapshotRecord | null): LightingCueEntry[] {
  const cues = snapshot?.cues;
  if (!Array.isArray(cues)) {
    return [];
  }

  return cues
    .flatMap((cue) => {
      const record = asRecord(cue);
      if (!record) {
        return [];
      }

      return [
        {
          fadeInMs: typeof record.fadeInMs === "number" ? record.fadeInMs : 0,
          fadeOutMs: typeof record.fadeOutMs === "number" ? record.fadeOutMs : 0,
          followSeconds: typeof record.followSeconds === "number" ? record.followSeconds : undefined,
          id: String(record.id ?? "cue"),
          label: String(record.label ?? record.id ?? "Cue"),
          notes: typeof record.notes === "string" ? record.notes : undefined,
          ordinal: typeof record.ordinal === "number" ? record.ordinal : 0,
          sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
          state: String(record.state ?? "pending"),
        },
      ];
    })
    .sort((left, right) => left.ordinal - right.ordinal);
}

export function getActiveLightingCue(snapshot: SnapshotRecord | null) {
  const cues = getLightingCues(snapshot);
  const activeCueId = typeof snapshot?.activeCueId === "string" ? snapshot.activeCueId : null;
  return cues.find((cue) => cue.id === activeCueId) ?? cues.find((cue) => cue.state === "active") ?? null;
}

export function getNextLightingCue(snapshot: SnapshotRecord | null) {
  const cues = getLightingCues(snapshot);
  if (cues.length === 0) {
    return null;
  }

  const activeCue = getActiveLightingCue(snapshot);
  if (!activeCue) {
    return cues[0] ?? null;
  }

  return cues.find((cue) => cue.ordinal > activeCue.ordinal) ?? activeCue;
}

export function getLightingDmxChannels(snapshot: SnapshotRecord | null): LightingDmxChannelEntry[] {
  const channels = snapshot?.channels;
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels
    .flatMap((channel) => {
      const record = asRecord(channel);
      if (!record) {
        return [];
      }

      return [
        {
          channel: typeof record.channel === "number" ? record.channel : 0,
          label: String(record.label ?? "Ch"),
          lightName: String(record.lightName ?? "Fixture"),
          value: typeof record.value === "number" ? record.value : 0,
        },
      ];
    })
    .sort((left, right) => left.channel - right.channel);
}

export function getAudioChannels(snapshot: SnapshotRecord | null): AudioChannelEntry[] {
  const channels = snapshot?.channels;
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels.flatMap((channel) => {
    const record = asRecord(channel);
    if (!record) {
      return [];
    }

    const mixLevelsRecord = asRecord(record.mixLevels);

    return [
      {
        autoSet: record.autoSet === true,
        clip: record.clip === true,
        fader: typeof record.fader === "number" ? record.fader : 0,
        gain: typeof record.gain === "number" ? record.gain : 0,
        id: String(record.id ?? "audio-channel"),
        instrument: record.instrument === true,
        meterLeft: typeof record.meterLeft === "number" ? record.meterLeft : 0,
        meterLevel: typeof record.meterLevel === "number" ? record.meterLevel : 0,
        meterRight: typeof record.meterRight === "number" ? record.meterRight : 0,
        mixLevels: mixLevelsRecord
          ? Object.fromEntries(
              Object.entries(mixLevelsRecord).flatMap(([key, value]) =>
                typeof value === "number" ? [[key, value]] : []
              )
            )
          : {},
        mute: record.mute === true,
        name: String(record.name ?? record.id ?? "Channel"),
        pad: record.pad === true,
        peakHold: typeof record.peakHold === "number" ? record.peakHold : 0,
        phase: record.phase === true,
        phantom: record.phantom === true,
        role: String(record.role ?? "channel"),
        shortName: String(record.shortName ?? record.name ?? record.id ?? "CH"),
        solo: record.solo === true,
        stereo: record.stereo === true,
      },
    ];
  });
}

export function getAudioMixTargets(snapshot: SnapshotRecord | null): AudioMixTargetEntry[] {
  const mixTargets = snapshot?.mixTargets;
  if (!Array.isArray(mixTargets)) {
    return [];
  }

  return mixTargets.flatMap((mixTarget) => {
    const record = asRecord(mixTarget);
    if (!record) {
      return [];
    }

    return [
      {
        dim: record.dim === true,
        id: String(record.id ?? "audio-mix-target"),
        mono: record.mono === true,
        mute: record.mute === true,
        name: String(record.name ?? record.id ?? "Mix target"),
        role: String(record.role ?? "mix-target"),
        shortName: String(record.shortName ?? record.name ?? record.id ?? "MIX"),
        talkback: record.talkback === true,
        volume: typeof record.volume === "number" ? record.volume : 0,
      },
    ];
  });
}

export function getAudioSnapshots(snapshot: SnapshotRecord | null): AudioSnapshotEntry[] {
  const snapshots = snapshot?.snapshots;
  if (!Array.isArray(snapshots)) {
    return [];
  }

  return snapshots
    .flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return [];
      }

      return [
        {
          id: String(record.id ?? "audio-snapshot"),
          lastRecalled: record.lastRecalled === true,
          lastRecalledAt: typeof record.lastRecalledAt === "string" ? record.lastRecalledAt : undefined,
          name: String(record.name ?? record.id ?? "Snapshot"),
          order: typeof record.order === "number" ? record.order : 0,
          oscIndex: typeof record.oscIndex === "number" ? record.oscIndex : 0,
        },
      ];
    })
    .sort((left, right) => left.order - right.order);
}

export function getPlanningProjects(snapshot: SnapshotRecord | null): PlanningProjectEntry[] {
  const projects = snapshot?.projects;
  if (!Array.isArray(projects)) {
    return [];
  }

  return projects
    .flatMap((project) => {
      const record = asRecord(project);
      if (!record) {
        return [];
      }

      return [
        {
          description: String(record.description ?? ""),
          id: String(record.id ?? "project"),
          lastUpdated: typeof record.lastUpdated === "string" ? record.lastUpdated : undefined,
          order: typeof record.order === "number" ? record.order : 0,
          priority: String(record.priority ?? "p2"),
          status: String(record.status ?? "todo"),
          title: String(record.title ?? record.id ?? "Project"),
        },
      ];
    })
    .sort((left, right) => left.order - right.order);
}

export function getPlanningTasks(snapshot: SnapshotRecord | null): PlanningTaskEntry[] {
  const tasks = snapshot?.tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks
    .flatMap((task) => {
      const record = asRecord(task);
      if (!record) {
        return [];
      }

      return [
        {
          checklist: Array.isArray(record.checklist)
            ? record.checklist.flatMap((item) => {
                const checklistRecord = asRecord(item);
                if (!checklistRecord) {
                  return [];
                }

                return [
                  {
                    done: checklistRecord.done === true,
                    id: String(checklistRecord.id ?? "checklist-item"),
                    text: String(checklistRecord.text ?? ""),
                  },
                ];
              })
            : [],
          completed: record.completed === true,
          createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
          description: String(record.description ?? ""),
          dueDate: typeof record.dueDate === "string" ? record.dueDate : undefined,
          id: String(record.id ?? "task"),
          isRunning: record.isRunning === true,
          labels: Array.isArray(record.labels)
            ? record.labels.flatMap((label) => (typeof label === "string" ? [label] : []))
            : [],
          lastStarted: typeof record.lastStarted === "string" ? record.lastStarted : undefined,
          order: typeof record.order === "number" ? record.order : 0,
          priority: String(record.priority ?? "p2"),
          projectId: String(record.projectId ?? "project"),
          scheduledDurationSeconds:
            typeof record.scheduledDurationSeconds === "number" ? record.scheduledDurationSeconds : undefined,
          scheduledStart: typeof record.scheduledStart === "string" ? record.scheduledStart : undefined,
          title: String(record.title ?? record.id ?? "Task"),
          totalSeconds: typeof record.totalSeconds === "number" ? record.totalSeconds : 0,
        },
      ];
    })
    .sort((left, right) => left.order - right.order);
}

export function getPlanningActivityLog(snapshot: SnapshotRecord | null): PlanningActivityEntry[] {
  const activityLog = snapshot?.activityLog;
  if (!Array.isArray(activityLog)) {
    return [];
  }

  return activityLog
    .flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) {
        return [];
      }

      return [
        {
          action: String(record.action ?? "updated"),
          detail: String(record.detail ?? ""),
          entityId: String(record.entityId ?? ""),
          entityType: String(record.entityType ?? "task"),
          id: String(record.id ?? "activity"),
          timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
        },
      ];
    })
    .sort((left, right) => {
      const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
      const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
      return rightTime - leftTime;
    });
}

export function getPlanningSettings(snapshot: SnapshotRecord | null): PlanningSettingsEntry {
  const settings = asRecord(snapshot?.settings);
  return {
    dashboardView: String(settings?.dashboardView ?? "kanban"),
    deckMode: String(settings?.deckMode ?? "project"),
    modeSection: settings?.modeSection === "board" ? "board" : "timeline",
    selectedProjectId: typeof settings?.selectedProjectId === "string" ? settings.selectedProjectId : undefined,
    selectedTaskId: typeof settings?.selectedTaskId === "string" ? settings.selectedTaskId : undefined,
    sortBy: String(settings?.sortBy ?? "manual"),
    timelineEndHour: typeof settings?.timelineEndHour === "number" ? settings.timelineEndHour : 22,
    timelineStartHour: typeof settings?.timelineStartHour === "number" ? settings.timelineStartHour : 9,
    viewFilter: String(settings?.viewFilter ?? "all"),
  };
}

export function getPlanningCounts(snapshot: SnapshotRecord | null): PlanningCountsEntry {
  const counts = asRecord(snapshot?.counts);
  return {
    completedTaskCount: typeof counts?.completedTaskCount === "number" ? counts.completedTaskCount : 0,
    projectCount: typeof counts?.projectCount === "number" ? counts.projectCount : 0,
    runningTaskCount: typeof counts?.runningTaskCount === "number" ? counts.runningTaskCount : 0,
    taskCount: typeof counts?.taskCount === "number" ? counts.taskCount : 0,
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
  lightingSnapshot: SnapshotRecord | null
) {
  if (activeWorkspace === "lighting") {
    const fixtures = getLightingFixtures(lightingSnapshot);
    const cues = getLightingCues(lightingSnapshot);
    const scenes = getLightingScenes(lightingSnapshot);
    const activeCue = getActiveLightingCue(lightingSnapshot);
    const selectedFixtureId =
      typeof lightingSnapshot?.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
    const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
    const onCount = fixtures.filter((fixture) => fixture.on === true).length;

    return [
      {
        title: "Lighting status",
        items: [
          {
            id: "lighting:summary",
            label: String(lightingSnapshot?.summary ?? "Awaiting lighting snapshot."),
          },
          {
            id: "lighting:transport",
            label: `Bridge ${String(lightingSnapshot?.bridgeIp ?? "unconfigured")} · Universe ${String(lightingSnapshot?.universe ?? 1)}`,
          },
          {
            id: "lighting:adapter",
            label: `Adapter ${String(lightingSnapshot?.adapterMode ?? "unknown")}`,
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
            label: `Scenes ${scenes.length} · Cues ${cues.length}`,
          },
          {
            id: "lighting:selection",
            label: selectedFixture
              ? `Selected fixture ${selectedFixture.name}`
              : activeCue
                ? `Active cue ${activeCue.label}`
                : "No fixture or cue selected.",
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
