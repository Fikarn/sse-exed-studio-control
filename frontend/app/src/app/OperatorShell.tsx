import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { AppShellFrame, Button, StatusBadge, Surface, type StatusTone } from "@sse/design-system";
import {
  useShellSnapshot,
  type JsonValue,
  type LightingDmxMonitorSnapshot,
  type LightingSnapshot,
  type PlanningSnapshot,
  type ShellState,
  type ShellStore,
} from "@sse/engine-client";
import { StagePlotPlaceholder } from "@sse/shared-graphics";

import styles from "./OperatorShell.module.css";
import { createShellEnvironment } from "./createShellEnvironment";
import {
  getActiveLightingCue,
  getLightingCues,
  getLightingDmxChannels,
  getLightingFixtures,
  getLightingGroups,
  getLightingScenes,
  getNextLightingCue,
  asRecord,
  asStatusTone,
  buildContextSections,
  buildMonitorItems,
  isEditableTarget,
  mapStatusBadgeTone,
  type SnapshotRecord,
} from "./shellData";
import { SetupSupportPilot } from "./setup/SetupSupportPilot";
import { SetupRecoverySurface } from "./setup/SetupRecoverySurface";
import { useTauriShellTestBridge } from "./tauriShellTestBridge";
import { AudioWorkspace } from "./audio/AudioWorkspace";
import { PlanningWorkspaceSurface } from "./planning/PlanningWorkspace";
import { ShellDialog } from "./shared/ShellDialog";
import { ShortcutOverlay } from "./shared/ShortcutOverlay";
import { RecoverySurface } from "./startup/RecoverySurface";
import { SetupStartupSurface } from "./startup/SetupStartupSurface";
import { StartupSurface } from "./startup/StartupSurface";
import {
  type ActionFeedback,
  deriveShellExperience,
  type FeedbackTone,
  feedbackBadgeTone,
} from "./startup/startupHelpers";

type ConfirmIntent = "restart-engine" | null;

const LIGHTING_ROOM_WIDTH_METERS = 12;
const LIGHTING_NUDGE_METERS = 0.1;

function GraphicsWorkspace({ title, subtitle, note }: { title: string; subtitle: string; note: string }) {
  return (
    <div className={styles.workspaceBody}>
      <section className={styles.primaryPanel}>
        <div className={styles.stagePlot}>
          <StagePlotPlaceholder title={title} subtitle={subtitle} />
        </div>
      </section>
      <aside className={styles.secondaryPanel}>
        <div className={styles.metaItem}>
          <div className={styles.metaLabel}>Shell direction</div>
          <div className={styles.metaValue}>{note}</div>
        </div>
      </aside>
    </div>
  );
}

function lightingStatusTone(status: unknown) {
  switch (status) {
    case "ready":
      return "ok";
    case "attention":
      return "attention";
    case "error":
      return "error";
    default:
      return "info";
  }
}

function lightingCueTone(state: string): StatusTone {
  switch (state) {
    case "active":
      return "connected";
    case "fired":
      return "healthy";
    default:
      return "idle";
  }
}

function lightingFixtureColor(cct: number, on: boolean) {
  if (!on) {
    return "color-mix(in srgb, var(--color-surface-500) 88%, black)";
  }

  if (cct <= 3200) {
    return "#ffb35c";
  }

  if (cct <= 4400) {
    return "#ffd38b";
  }

  return "#eaf0ff";
}

function defaultLightingBeamAngle(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return 110;
    case "infinimat":
      return 100;
    case "apollo bridge":
    case "astra":
    case "astra bi-color":
    case "astra-bicolor":
      return 50;
    default:
      return 60;
  }
}

function lightingFixtureBeamAngle(fixtureType: string, beamAngleDegrees?: number) {
  const fallback = defaultLightingBeamAngle(fixtureType);
  if (typeof beamAngleDegrees !== "number" || Number.isNaN(beamAngleDegrees)) {
    return fallback;
  }
  return Math.max(1, Math.min(180, beamAngleDegrees));
}

function formatLightingRigHeight(rigZ?: number) {
  return typeof rigZ === "number" && Number.isFinite(rigZ) ? `${rigZ.toFixed(1)} m` : "Auto";
}

function formatLightingBeamAngleValue(fixtureType: string, beamAngleDegrees?: number) {
  return `${Math.round(lightingFixtureBeamAngle(fixtureType, beamAngleDegrees))}°`;
}

function lightingFixtureBeamLength(kind: string) {
  switch (kind.trim().toLowerCase()) {
    case "beam":
      return 19;
    case "wash":
      return 24;
    default:
      return 22;
  }
}

function lightingFixtureBeamWidth(beamAngleDegrees: number, beamLength: number) {
  return Math.max(10, Math.min(42, (beamAngleDegrees / 180) * beamLength * 1.6));
}

function lightingFixtureBeamOpacity(intensity: number, on: boolean) {
  if (!on || intensity <= 0) {
    return 0;
  }
  return Math.max(0.16, Math.min(0.44, 0.14 + (intensity / 100) * 0.3));
}

function clampLightingIntensity(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function interpolateLightingValue(start: number, end: number, progress: number) {
  return start + (end - start) * Math.max(0, Math.min(1, progress));
}

function lightingFixtureStageFadeOpacity(intensity: number, on: boolean) {
  if (!on || intensity <= 0) {
    return 0.22;
  }
  return Math.max(0.22, Math.min(1, 0.18 + (intensity / 100) * 0.82));
}

function lightingFixtureCctRange(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinimat":
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return { max: 10_000, min: 2_000 };
    default:
      return { max: 5_600, min: 3_200 };
  }
}

function lightingFixtureCctPercent(cct: number, fixtureType: string) {
  const range = lightingFixtureCctRange(fixtureType);
  const clamped = Math.max(range.min, Math.min(range.max, Math.round(cct)));
  return ((clamped - range.min) / (range.max - range.min)) * 100;
}

function lightingFixtureChannelCount(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "infinimat":
      return 4;
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return 8;
    default:
      return 2;
  }
}

function lightingFixtureChannelLabels(fixtureType: string) {
  const normalized = fixtureType.trim().toLowerCase();
  switch (normalized) {
    case "astra":
    case "astra bi-color":
    case "astra-bicolor":
    case "apollo bridge":
      return ["Dimmer", "CCT"];
    case "infinimat":
      return ["Dimmer", "CCT", "±G/M", "Strobe"];
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return ["Dimmer", "CCT", "Mix", "Red", "Green", "Blue", "FX", "Speed"];
    default:
      return [];
  }
}

function lightingFixtureMaxStartAddress(fixtureType: string) {
  return 512 - lightingFixtureChannelCount(fixtureType) + 1;
}

function lightingFixturePatchSummary(dmxStartAddress: number, fixtureType: string) {
  const channelCount = lightingFixtureChannelCount(fixtureType);
  return `u1 · ${dmxStartAddress}-${dmxStartAddress + channelCount - 1} (${channelCount} ch)`;
}

function lightingFixtureModeLabel(fixtureType: string) {
  return `${lightingFixtureChannelCount(fixtureType)} ch mode`;
}

function lightingPatchBarSegments(value: number) {
  return Math.max(0, Math.min(8, Math.round((Math.max(0, Math.min(255, value)) / 255) * 8)));
}

function formatLightingCueFadeSeconds(fadeInMs: number) {
  return `${(Math.max(0, fadeInMs) / 1000).toFixed(1)} s`;
}

function formatLightingValueRange(min: number, max: number, suffix: string) {
  return min === max ? `${min}${suffix}` : `${min}-${max}${suffix}`;
}

function findNextLightingFixtureStartAddress(
  fixtures: Array<{ dmxStartAddress: number; type: string }>,
  fixtureType: string
) {
  const channelCount = lightingFixtureChannelCount(fixtureType);
  const maxStartAddress = lightingFixtureMaxStartAddress(fixtureType);

  for (let startAddress = 1; startAddress <= maxStartAddress; startAddress += 1) {
    const endAddress = startAddress + channelCount - 1;
    const overlaps = fixtures.some((fixture) => {
      const existingStart = fixture.dmxStartAddress;
      const existingEnd = existingStart + lightingFixtureChannelCount(fixture.type) - 1;
      return startAddress <= existingEnd && endAddress >= existingStart;
    });
    if (!overlaps) {
      return startAddress;
    }
  }

  return maxStartAddress;
}

function lightingPatchRangeOverlaps(
  fixtures: Array<{ dmxStartAddress: number; type: string }>,
  startAddress: number,
  channelCount: number
) {
  const endAddress = startAddress + channelCount - 1;
  return fixtures.some((fixture) => {
    const existingStart = fixture.dmxStartAddress;
    const existingEnd = existingStart + lightingFixtureChannelCount(fixture.type) - 1;
    return startAddress <= existingEnd && endAddress >= existingStart;
  });
}

function buildLightingPatchCandidates(fixtures: Array<{ dmxStartAddress: number; type: string }>, limit = 12) {
  if (fixtures.length === 0) {
    return [1];
  }

  const requiredChannelCount = Math.max(...fixtures.map((fixture) => lightingFixtureChannelCount(fixture.type)));
  const maxStartAddress = 512 - requiredChannelCount + 1;
  const candidates: number[] = [];

  for (let startAddress = 1; startAddress <= maxStartAddress; startAddress += 1) {
    if (!lightingPatchRangeOverlaps(fixtures, startAddress, requiredChannelCount)) {
      candidates.push(startAddress);
    }
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

function buildLightingPatchOverlapMap(
  fixtures: Array<{ dmxStartAddress: number; id: string; name: string; type: string }>
) {
  const overlaps = new Map<
    string,
    {
      conflictingFixtureNames: string[];
      suggestedEndAddress: number | null;
      suggestedStartAddress: number | null;
    }
  >();

  fixtures.forEach((fixture) => {
    const channelCount = lightingFixtureChannelCount(fixture.type);
    const fixtureStart = fixture.dmxStartAddress;
    const fixtureEnd = fixtureStart + channelCount - 1;
    const conflictingFixtures = fixtures.filter((candidate) => {
      if (candidate.id === fixture.id) {
        return false;
      }

      const candidateStart = candidate.dmxStartAddress;
      const candidateEnd = candidateStart + lightingFixtureChannelCount(candidate.type) - 1;
      return fixtureStart <= candidateEnd && fixtureEnd >= candidateStart;
    });

    if (conflictingFixtures.length === 0) {
      return;
    }

    const fixturesExcludingCurrent = fixtures.filter((candidate) => candidate.id !== fixture.id);
    const suggestedStartAddress = findNextLightingFixtureStartAddress(fixturesExcludingCurrent, fixture.type);
    const safeSuggestedStartAddress = lightingPatchRangeOverlaps(
      fixturesExcludingCurrent,
      suggestedStartAddress,
      channelCount
    )
      ? null
      : suggestedStartAddress;

    overlaps.set(fixture.id, {
      conflictingFixtureNames: conflictingFixtures.map((candidate) => candidate.name),
      suggestedEndAddress: safeSuggestedStartAddress === null ? null : safeSuggestedStartAddress + channelCount - 1,
      suggestedStartAddress: safeSuggestedStartAddress,
    });
  });

  return overlaps;
}

function formatLightingPatchOverlapSummary(conflictingFixtureNames: string[]) {
  if (conflictingFixtureNames.length === 1) {
    return `Overlaps ${conflictingFixtureNames[0]}`;
  }

  if (conflictingFixtureNames.length === 2) {
    return `Overlaps ${conflictingFixtureNames[0]} + ${conflictingFixtureNames[1]}`;
  }

  return `Overlaps ${conflictingFixtureNames.length} fixtures`;
}

function formatLightingPatchOverlapStageLabel(conflictingFixtureNames: string[]) {
  return `⚠ ${formatLightingPatchOverlapSummary(conflictingFixtureNames).toUpperCase()}`;
}

function lightingSearchMatchesFixture(
  fixture: {
    kind: string;
    name: string;
    type: string;
  },
  groupLabel: string,
  query: string
) {
  if (!query) {
    return true;
  }

  const haystack = `${fixture.name} ${fixture.type} ${fixture.kind} ${groupLabel}`.toLowerCase();
  return haystack.includes(query);
}

function isLightingRangeCommitKey(key: string) {
  return (
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key.startsWith("Arrow") ||
    /^[0-9]$/.test(key)
  );
}

function fallbackFixturePosition(index: number) {
  const columns = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: 0.16 + column * 0.2,
    y: 0.24 + row * 0.18,
  };
}

function formatDmxValue(value: number) {
  const normalized = Math.max(0, Math.min(255, Math.round(value)));
  return normalized.toString(16).toUpperCase().padStart(2, "0");
}

interface LightingSectionDefinition {
  id: string;
  key: string;
  label: string;
  xMax: number;
  xMin: number;
  yMax: number;
  yMin: number;
}

const LIGHTING_SECTION_DEFINITIONS: LightingSectionDefinition[] = [
  { id: "stage-left", key: "1", label: "Stage Left", xMin: 0, xMax: 0.34, yMin: 0, yMax: 1 },
  { id: "center-line", key: "2", label: "Center Line", xMin: 0.34, xMax: 0.66, yMin: 0, yMax: 1 },
  { id: "stage-right", key: "3", label: "Stage Right", xMin: 0.66, xMax: 1, yMin: 0, yMax: 1 },
  { id: "upstage", key: "4", label: "Upstage", xMin: 0, xMax: 1, yMin: 0, yMax: 0.42 },
  { id: "downstage", key: "5", label: "Downstage", xMin: 0, xMax: 1, yMin: 0.42, yMax: 1 },
];

function fixtureMatchesLightingSection(
  fixture: { spatialX?: number; spatialY?: number },
  section: LightingSectionDefinition
) {
  if (typeof fixture.spatialX !== "number" || typeof fixture.spatialY !== "number") {
    return false;
  }

  return (
    fixture.spatialX >= section.xMin &&
    fixture.spatialX <= section.xMax &&
    fixture.spatialY >= section.yMin &&
    fixture.spatialY <= section.yMax
  );
}

function buildLightingSections(fixtures: Array<{ spatialX?: number; spatialY?: number }>): LightingSectionDefinition[] {
  return LIGHTING_SECTION_DEFINITIONS.filter((section) =>
    fixtures.some((fixture) => fixtureMatchesLightingSection(fixture, section))
  );
}

function LightingWorkspaceSurface({
  appSnapshot,
  lightingDmxMonitorSnapshot,
  lightingSnapshot,
  store,
}: {
  appSnapshot: SnapshotRecord | null;
  lightingDmxMonitorSnapshot: LightingDmxMonitorSnapshot | null;
  lightingSnapshot: LightingSnapshot | null;
  store: ShellStore;
}) {
  const shellLighting = asRecord(asRecord(appSnapshot?.shell)?.lighting);
  const persistedSelectedCueId = typeof shellLighting?.selectedCueId === "string" ? shellLighting.selectedCueId : null;
  const persistedSectionId =
    typeof shellLighting?.currentSectionId === "string" ? shellLighting.currentSectionId : null;
  // `lightingSnapshotLoaded` and `loaded` are fixture-only loading-state
  // markers (see frontend/packages/test-fixtures/src/fixtures.json). They
  // are not part of the engine's wire format, so they're absent from the
  // generated LightingSnapshot type. Read them through an unknown cast.
  const lightingFixtureFlags = lightingSnapshot as unknown as {
    lightingSnapshotLoaded?: boolean;
    loaded?: boolean;
  } | null;
  const lightingSnapshotLoaded =
    lightingFixtureFlags?.lightingSnapshotLoaded !== false && lightingFixtureFlags?.loaded !== false;
  const dmxChannels = useMemo(() => getLightingDmxChannels(lightingDmxMonitorSnapshot), [lightingDmxMonitorSnapshot]);
  const fixtures = useMemo(() => getLightingFixtures(lightingSnapshot), [lightingSnapshot]);
  const scenes = useMemo(() => getLightingScenes(lightingSnapshot), [lightingSnapshot]);
  const cues = useMemo(() => getLightingCues(lightingSnapshot), [lightingSnapshot]);
  const groups = useMemo(() => getLightingGroups(lightingSnapshot), [lightingSnapshot]);
  const groupStates = useMemo(
    () =>
      groups.map((group) => {
        const groupFixtures = fixtures.filter((fixture) => fixture.groupId === group.id);
        const onGroupFixtures = groupFixtures.filter((fixture) => fixture.on === true).length;
        const intensityValues = groupFixtures.map((fixture) => fixture.intensity);
        const cctValues = groupFixtures.map((fixture) => fixture.cct);
        return {
          ...group,
          allOn: groupFixtures.length > 0 && onGroupFixtures === groupFixtures.length,
          averageCct:
            cctValues.length > 0 ? Math.round(cctValues.reduce((sum, value) => sum + value, 0) / cctValues.length) : 0,
          averageIntensity:
            intensityValues.length > 0
              ? Math.round(intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length)
              : 0,
          cctMax: cctValues.length > 0 ? Math.max(...cctValues) : 0,
          cctMin: cctValues.length > 0 ? Math.min(...cctValues) : 0,
          fixtures: groupFixtures,
          intensityMax: intensityValues.length > 0 ? Math.max(...intensityValues) : 0,
          intensityMin: intensityValues.length > 0 ? Math.min(...intensityValues) : 0,
          mixed: onGroupFixtures > 0 && onGroupFixtures < groupFixtures.length,
          onFixtureCount: onGroupFixtures,
        };
      }),
    [fixtures, groups]
  );
  const onCount = fixtures.filter((fixture) => fixture.on === true).length;
  const activeCue = useMemo(() => getActiveLightingCue(lightingSnapshot), [lightingSnapshot]);
  const nextCue = useMemo(() => getNextLightingCue(lightingSnapshot), [lightingSnapshot]);
  const selectedFixtureId =
    typeof lightingSnapshot?.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? null;
  const selectedSceneId =
    typeof lightingSnapshot?.selectedSceneId === "string" ? lightingSnapshot.selectedSceneId : null;
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(persistedSectionId);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [lassoSelectionIds, setLassoSelectionIds] = useState<string[]>([]);
  const [lassoDraft, setLassoDraft] = useState<{
    endX: number;
    endY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [lassoGroupName, setLassoGroupName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const blackoutTimerRef = useRef<number | null>(null);
  const identifyTimerRef = useRef<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const suppressFixtureClickRef = useRef(false);
  const fixtureDragRef = useRef<{
    fixtureId: string;
    lastX: number;
    lastY: number;
    moved: boolean;
    startClientX: number;
    startClientY: number;
  } | null>(null);
  const lassoDraftRef = useRef<{
    endX: number;
    endY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const sceneNameInputRef = useRef<HTMLInputElement | null>(null);
  const [blackoutHolding, setBlackoutHolding] = useState(false);
  const [dmxDrawerOpen, setDmxDrawerOpen] = useState(false);
  const [dmxOverlayChannel, setDmxOverlayChannel] = useState<number | null>(null);
  const [patchMode, setPatchMode] = useState(false);
  const [fixtureIntensityDraft, setFixtureIntensityDraft] = useState<number | null>(null);
  const [fixtureCctDraft, setFixtureCctDraft] = useState<number | null>(null);
  const [fixturePatchDraft, setFixturePatchDraft] = useState("");
  const [fixtureRigZDraft, setFixtureRigZDraft] = useState("");
  const [fixtureBeamAngleDraft, setFixtureBeamAngleDraft] = useState("");
  const [identifyFixtureId, setIdentifyFixtureId] = useState<string | null>(null);
  const [sceneNameDraft, setSceneNameDraft] = useState("");
  const cueLabelInputRef = useRef<HTMLInputElement | null>(null);
  const [cueEditorCueId, setCueEditorCueId] = useState<string | null>(null);
  const [cueLabelDraft, setCueLabelDraft] = useState("");
  const [cueSceneIdDraft, setCueSceneIdDraft] = useState<string>("");
  const [cueFadeInDraft, setCueFadeInDraft] = useState("");
  const [cueFadeOutDraft, setCueFadeOutDraft] = useState("");
  const [cueFollowDraft, setCueFollowDraft] = useState("");
  const [cueNotesDraft, setCueNotesDraft] = useState("");
  const [pendingCueJumpId, setPendingCueJumpId] = useState<string | null>(null);
  const [dragPatchStartAddress, setDragPatchStartAddress] = useState<number | null>(null);
  const [patchDropTargetId, setPatchDropTargetId] = useState<string | null>(null);
  const [dragFixturePreview, setDragFixturePreview] = useState<{
    fixtureId: string;
    x: number;
    y: number;
  } | null>(null);
  const [cueTransition, setCueTransition] = useState<{
    cueId: string;
    cueLabel: string;
    durationMs: number;
    previousCueId: string | null;
    startedAt: number;
  } | null>(null);
  const [cueTransitionElapsedMs, setCueTransitionElapsedMs] = useState(0);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const lightingSections = useMemo(() => buildLightingSections(fixtures), [fixtures]);
  const activeSection = lightingSections.find((section) => section.id === currentSectionId) ?? null;
  const selectedCue = cues.find((cue) => cue.id === selectedCueId) ?? activeCue ?? nextCue ?? cues[0] ?? null;
  const inspectorCue = !selectedFixture && !selectedCueId ? (nextCue ?? activeCue ?? selectedCue) : selectedCue;
  const cueEditorCue = cueEditorCueId !== null ? (cues.find((cue) => cue.id === cueEditorCueId) ?? null) : null;
  const pendingCueJump = pendingCueJumpId !== null ? (cues.find((cue) => cue.id === pendingCueJumpId) ?? null) : null;
  const selectedScene =
    scenes.find((scene) => scene.id === (selectedCue?.sceneId ?? selectedSceneId)) ??
    scenes.find((scene) => scene.id === selectedSceneId) ??
    null;
  const inspectorScene =
    scenes.find((scene) => scene.id === (inspectorCue?.sceneId ?? selectedSceneId)) ??
    scenes.find((scene) => scene.id === selectedSceneId) ??
    null;
  const selectedFixtureCctRange = selectedFixture
    ? lightingFixtureCctRange(selectedFixture.type)
    : { max: 5_600, min: 3_200 };
  const selectedFixtureMaxStartAddress = selectedFixture ? lightingFixtureMaxStartAddress(selectedFixture.type) : 511;
  const selectedGroup = groupStates.find((group) => group.id === selectedGroupId) ?? null;
  const filteredFixtureIds = useMemo(
    () =>
      new Set(
        fixtures
          .filter((fixture) => {
            const groupLabel = groups.find((group) => group.id === fixture.groupId)?.name ?? "ungrouped";
            return lightingSearchMatchesFixture(fixture, groupLabel, deferredSearchQuery);
          })
          .map((fixture) => fixture.id)
      ),
    [deferredSearchQuery, fixtures, groups]
  );
  const searchActive = deferredSearchQuery.length > 0;
  const searchHitCount = filteredFixtureIds.size;
  const plottedFixtures = useMemo(
    () =>
      fixtures.slice(0, 24).map((fixture, index) => {
        const fallback = fallbackFixturePosition(index);
        const x = typeof fixture.spatialX === "number" ? fixture.spatialX : fallback.x;
        const y = typeof fixture.spatialY === "number" ? fixture.spatialY : fallback.y;
        return {
          ...fixture,
          cct: typeof fixture.cct === "number" ? fixture.cct : 3200,
          inActiveSection:
            activeSection === null || fixtureMatchesLightingSection({ spatialX: x, spatialY: y }, activeSection),
          matchesSearch: filteredFixtureIds.has(fixture.id),
          on: fixture.on === true,
          x,
          y,
        };
      }),
    [activeSection, filteredFixtureIds, fixtures]
  );
  const selectedPlottedFixture = selectedFixture
    ? (plottedFixtures.find((fixture) => fixture.id === selectedFixture.id) ?? null)
    : null;
  const selectedFixtureGroups = useMemo(
    () => (selectedFixture ? groups.filter((group) => group.id === selectedFixture.groupId) : []),
    [groups, selectedFixture]
  );
  const lassoFixtures = useMemo(
    () => plottedFixtures.filter((fixture) => lassoSelectionIds.includes(fixture.id)),
    [lassoSelectionIds, plottedFixtures]
  );
  const lassoGroupState = useMemo(() => {
    if (lassoFixtures.length < 2) {
      return null;
    }

    const onCount = lassoFixtures.filter((fixture) => fixture.on).length;
    const intensityValues = lassoFixtures.map((fixture) => fixture.intensity);
    const cctValues = lassoFixtures.map((fixture) => fixture.cct);
    return {
      averageCct:
        cctValues.length > 0 ? Math.round(cctValues.reduce((sum, value) => sum + value, 0) / cctValues.length) : 0,
      averageIntensity:
        intensityValues.length > 0
          ? Math.round(intensityValues.reduce((sum, value) => sum + value, 0) / intensityValues.length)
          : 0,
      cctMax: cctValues.length > 0 ? Math.max(...cctValues) : 0,
      cctMin: cctValues.length > 0 ? Math.min(...cctValues) : 0,
      fixtureCount: lassoFixtures.length,
      fixtures: lassoFixtures,
      intensityMax: intensityValues.length > 0 ? Math.max(...intensityValues) : 0,
      intensityMin: intensityValues.length > 0 ? Math.min(...intensityValues) : 0,
      mixed: onCount > 0 && onCount < lassoFixtures.length,
      onFixtureCount: onCount,
    };
  }, [lassoFixtures]);
  const sceneCaptureAvailable = Boolean(selectedFixture || selectedGroup || lassoGroupState);
  const sceneCaptureSelectionLabel = selectedFixture
    ? selectedFixture.name
    : selectedGroup
      ? selectedGroup.name
      : lassoGroupState
        ? `${lassoGroupState.fixtureCount} fixtures`
        : "Current selection";
  const selectedFixtureCueMemberships = useMemo(() => {
    if (!selectedFixture) {
      return [];
    }

    const fixtureScenes = scenes.filter((scene) =>
      scene.fixtureStates.some((fixtureState) => fixtureState.fixtureId === selectedFixture.id)
    );
    const fixtureSceneIds = new Set(fixtureScenes.map((scene) => scene.id));
    return cues.filter((cue) => cue.sceneId && fixtureSceneIds.has(cue.sceneId));
  }, [cues, scenes, selectedFixture]);
  const selectedFixturePatchRows = useMemo(() => {
    if (!selectedFixture) {
      return [];
    }

    const channelCount = lightingFixtureChannelCount(selectedFixture.type);
    const labels = lightingFixtureChannelLabels(selectedFixture.type);
    return Array.from({ length: channelCount }, (_, offset) => {
      const channelNumber = selectedFixture.dmxStartAddress + offset;
      const dmxChannel = dmxChannels.find((channel) => channel.channel === channelNumber) ?? null;
      return {
        channel: channelNumber,
        label: dmxChannel?.label ?? labels[offset] ?? `Ch${offset + 1}`,
        value: dmxChannel?.value ?? 0,
      };
    });
  }, [dmxChannels, selectedFixture]);
  const patchCandidateStartAddresses = useMemo(() => buildLightingPatchCandidates(fixtures), [fixtures]);
  const patchOverlapByFixtureId = useMemo(() => buildLightingPatchOverlapMap(fixtures), [fixtures]);
  const selectedFixturePatchOverlap =
    selectedFixture !== null ? (patchOverlapByFixtureId.get(selectedFixture.id) ?? null) : null;
  const inspectorCueDeltaRows = useMemo(() => {
    if (!inspectorCue || !inspectorScene) {
      return [];
    }

    return inspectorScene.fixtureStates.flatMap((fixtureState) => {
      const fixture = fixtures.find((entry) => entry.id === fixtureState.fixtureId);
      if (!fixture) {
        return [];
      }

      const fromLabel = fixture.on && fixture.intensity > 0 ? `${fixture.intensity}%` : "OFF";
      const toLabel = fixtureState.on && fixtureState.intensity > 0 ? `${fixtureState.intensity}%` : "OFF";
      if (fromLabel === toLabel) {
        return [];
      }

      return [
        {
          fixtureId: fixture.id,
          fixtureName: fixture.name,
          fromLabel,
          toLabel,
          direction: toLabel === "OFF" || fixtureState.intensity < fixture.intensity ? "falling" : "rising",
        },
      ];
    });
  }, [fixtures, inspectorCue, inspectorScene]);
  const bridgeIp = String(lightingSnapshot?.bridgeIp ?? "unconfigured");
  const universe = String(lightingSnapshot?.universe ?? 1);
  const status = String(lightingSnapshot?.status ?? "pending");
  const dmxPreviewChannels = dmxChannels.slice(0, 12);
  const expandedDmxChannels = useMemo(() => {
    const channelMap = new Map(dmxChannels.map((channel) => [channel.channel, channel]));
    return Array.from({ length: 88 }, (_, index) => {
      const channelNumber = index + 1;
      const existing = channelMap.get(channelNumber);
      return {
        channel: channelNumber,
        label: existing?.label ?? "—",
        lightName: existing?.lightName ?? "Unpatched",
        value: existing?.value ?? 0,
      };
    });
  }, [dmxChannels]);
  const dmxPreviewLabel =
    dmxPreviewChannels.length > 0
      ? `Channels ${dmxPreviewChannels[0]?.channel ?? 0}-${dmxPreviewChannels.at(-1)?.channel ?? 0}`
      : "Awaiting DMX monitor";
  const stageMarkers = useMemo(() => {
    const buildMarker = (id: "camera" | "subject", label: string, marker: unknown) => {
      const record = asRecord(marker);
      if (!record) {
        return [];
      }

      const x = typeof record.x === "number" ? Math.max(0, Math.min(1, record.x)) : null;
      const y = typeof record.y === "number" ? Math.max(0, Math.min(1, record.y)) : null;
      if (x === null || y === null) {
        return [];
      }

      return [
        {
          id,
          label,
          rotation: typeof record.rotation === "number" ? record.rotation : 0,
          x,
          y,
        },
      ];
    };

    return [
      ...buildMarker("camera", "Camera", lightingSnapshot?.cameraMarker),
      ...buildMarker("subject", "Subject", lightingSnapshot?.subjectMarker),
    ];
  }, [lightingSnapshot]);
  const selectedDmxOverlayChannel =
    (dmxOverlayChannel !== null
      ? (expandedDmxChannels.find((channel) => channel.channel === dmxOverlayChannel) ?? null)
      : null) ??
    expandedDmxChannels[0] ??
    null;
  const dmxStale = lightingSnapshot?.reachable === false;
  const cueOutputMuted = patchMode;
  const cueEditorBusy = busyAction === "cue-update" || busyAction === "cue-delete";
  const cueTransitionPreviousCue =
    cueTransition?.previousCueId !== null && cueTransition?.previousCueId !== undefined
      ? (cues.find((cue) => cue.id === cueTransition.previousCueId) ?? null)
      : null;
  const cueTransitionProgress =
    cueTransition === null
      ? 0
      : Math.min(1, cueTransition.durationMs <= 0 ? 1 : cueTransitionElapsedMs / cueTransition.durationMs);
  const cueTransitionPulseActive = cueTransition !== null && cueTransitionElapsedMs < 500;
  const cueTransitionCue = cueTransition !== null ? (cues.find((cue) => cue.id === cueTransition.cueId) ?? null) : null;
  const cueTransitionTargetScene =
    cueTransitionCue?.sceneId !== undefined
      ? (scenes.find((scene) => scene.id === cueTransitionCue.sceneId) ?? null)
      : null;
  const cueTransitionPreviousScene =
    cueTransitionPreviousCue?.sceneId !== undefined
      ? (scenes.find((scene) => scene.id === cueTransitionPreviousCue.sceneId) ?? null)
      : null;
  const stageFixtures = useMemo(() => {
    const baseFixtures = plottedFixtures.map((fixture) => ({
      ...fixture,
      displayCct: fixture.cct,
      displayIntensity: fixture.intensity,
      displayOn: fixture.on,
    }));

    if (cueTransition === null || cueTransitionTargetScene === null) {
      return baseFixtures;
    }

    const previousStateByFixtureId = new Map(
      (cueTransitionPreviousScene?.fixtureStates ?? []).map((fixtureState) => [fixtureState.fixtureId, fixtureState])
    );
    const targetStateByFixtureId = new Map(
      cueTransitionTargetScene.fixtureStates.map((fixtureState) => [fixtureState.fixtureId, fixtureState])
    );

    return baseFixtures.map((fixture) => {
      const previousState = previousStateByFixtureId.get(fixture.id);
      const targetState = targetStateByFixtureId.get(fixture.id);
      const fromIntensity =
        previousState !== undefined
          ? clampLightingIntensity(previousState.on ? previousState.intensity : 0)
          : cueTransitionPreviousCue === null
            ? 0
            : clampLightingIntensity(fixture.on ? fixture.intensity : 0);
      const toIntensity =
        targetState !== undefined
          ? clampLightingIntensity(targetState.on ? targetState.intensity : 0)
          : clampLightingIntensity(fixture.on ? fixture.intensity : 0);
      const fromCct =
        previousState !== undefined
          ? Math.round(previousState.cct)
          : targetState !== undefined
            ? Math.round(targetState.cct)
            : fixture.cct;
      const toCct = targetState !== undefined ? Math.round(targetState.cct) : fixture.cct;
      const displayIntensity = clampLightingIntensity(
        interpolateLightingValue(fromIntensity, toIntensity, cueTransitionProgress)
      );

      return {
        ...fixture,
        displayCct: Math.round(interpolateLightingValue(fromCct, toCct, cueTransitionProgress)),
        displayIntensity,
        displayOn: displayIntensity > 0 || (toIntensity > 0 && cueTransitionProgress > 0),
      };
    });
  }, [
    cueTransition,
    cueTransitionPreviousCue,
    cueTransitionPreviousScene,
    cueTransitionProgress,
    cueTransitionTargetScene,
    plottedFixtures,
  ]);
  const cueTarget = nextCue ?? selectedCue;
  const previousCue = activeCue ? (cues.filter((cue) => cue.ordinal < activeCue.ordinal).at(-1) ?? null) : null;

  useEffect(() => {
    setSelectedCueId((current) => {
      if (current && cues.some((cue) => cue.id === current)) {
        return current;
      }

      if (persistedSelectedCueId && cues.some((cue) => cue.id === persistedSelectedCueId)) {
        return persistedSelectedCueId;
      }

      return activeCue?.id ?? nextCue?.id ?? cues[0]?.id ?? null;
    });
  }, [activeCue?.id, cues, nextCue?.id, persistedSelectedCueId]);

  useEffect(() => {
    setCurrentSectionId(persistedSectionId);
  }, [persistedSectionId]);

  useEffect(() => {
    setFixtureIntensityDraft(selectedFixture ? selectedFixture.intensity : null);
  }, [selectedFixture?.id, selectedFixture?.intensity]);

  useEffect(() => {
    setFixtureCctDraft(selectedFixture ? selectedFixture.cct : null);
  }, [selectedFixture?.cct, selectedFixture?.id]);

  useEffect(() => {
    setFixturePatchDraft(selectedFixture ? String(selectedFixture.dmxStartAddress) : "");
  }, [selectedFixture?.dmxStartAddress, selectedFixture?.id]);

  useEffect(() => {
    setFixtureRigZDraft(
      selectedFixture && typeof selectedFixture.rigZ === "number" ? String(selectedFixture.rigZ) : ""
    );
  }, [selectedFixture?.id, selectedFixture?.rigZ]);

  useEffect(() => {
    setFixtureBeamAngleDraft(
      selectedFixture && typeof selectedFixture.beamAngleDegrees === "number"
        ? String(selectedFixture.beamAngleDegrees)
        : ""
    );
  }, [selectedFixture?.beamAngleDegrees, selectedFixture?.id]);

  useEffect(() => {
    if (!patchMode) {
      setDragPatchStartAddress(null);
      setPatchDropTargetId(null);
      fixtureDragRef.current = null;
      setDragFixturePreview(null);
      if (identifyTimerRef.current !== null) {
        window.clearTimeout(identifyTimerRef.current);
        identifyTimerRef.current = null;
      }
      setIdentifyFixtureId(null);
      return;
    }
    setCueTransition(null);
    setCueTransitionElapsedMs(0);
  }, [patchMode]);

  useEffect(() => {
    return () => {
      if (identifyTimerRef.current !== null) {
        window.clearTimeout(identifyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!cueTransition) {
      setCueTransitionElapsedMs(0);
      return;
    }

    let frameId = 0;
    const tick = () => {
      const elapsed = Date.now() - cueTransition.startedAt;
      if (elapsed >= cueTransition.durationMs) {
        setCueTransition(null);
        setCueTransitionElapsedMs(cueTransition.durationMs);
        return;
      }

      setCueTransitionElapsedMs(elapsed);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [cueTransition]);

  useEffect(() => {
    if (selectedFixture) {
      setCueEditorCueId(null);
      setSelectedGroupId(null);
      setLassoSelectionIds([]);
    }
  }, [selectedFixture]);

  useEffect(() => {
    if (selectedGroupId && !groupStates.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(null);
    }
  }, [groupStates, selectedGroupId]);

  useEffect(() => {
    if (currentSectionId && !lightingSections.some((section) => section.id === currentSectionId)) {
      setCurrentSectionId(null);
      void store.setLightingSection(null);
    }
  }, [currentSectionId, lightingSections, store]);

  useEffect(() => {
    if (lassoSelectionIds.length > 1) {
      setLassoGroupName(`Group ${groups.length + 1}`);
    } else {
      setLassoGroupName("");
    }
  }, [groups.length, lassoSelectionIds.length]);

  useEffect(() => {
    if (!sceneCaptureAvailable) {
      setSceneNameDraft("");
      return;
    }

    setSceneNameDraft((current) => (current.trim() ? current : `Scene ${scenes.length + 1}`));
  }, [sceneCaptureAvailable, scenes.length]);

  useEffect(() => {
    if (cueEditorCueId && !cues.some((cue) => cue.id === cueEditorCueId)) {
      setCueEditorCueId(null);
    }
  }, [cueEditorCueId, cues]);

  useEffect(() => {
    if (!cueEditorCue) {
      setCueLabelDraft("");
      setCueSceneIdDraft("");
      setCueFadeInDraft("");
      setCueFadeOutDraft("");
      setCueFollowDraft("");
      setCueNotesDraft("");
      return;
    }

    setCueLabelDraft(cueEditorCue.label);
    setCueSceneIdDraft(cueEditorCue.sceneId ?? "");
    setCueFadeInDraft(String(cueEditorCue.fadeInMs));
    setCueFadeOutDraft(String(cueEditorCue.fadeOutMs));
    setCueFollowDraft(
      cueEditorCue.followSeconds === undefined || cueEditorCue.followSeconds === null
        ? ""
        : String(cueEditorCue.followSeconds)
    );
    setCueNotesDraft(cueEditorCue.notes ?? "");
    window.requestAnimationFrame(() => {
      cueLabelInputRef.current?.focus();
      cueLabelInputRef.current?.select();
    });
  }, [cueEditorCue]);

  const fireCue = useEffectEvent(async (actionId: string, cueId: string, fadeOverrideMs?: number) => {
    if (patchMode) {
      setFeedback({
        message: "Patch mode is active. Exit patch mode to resume cue output.",
        tone: "info",
      });
      return;
    }

    setBusyAction(actionId);
    setFeedback(null);

    try {
      const result = asRecord(await store.fireLightingCue(cueId, fadeOverrideMs));
      const firedCue = cues.find((cue) => cue.id === cueId) ?? null;
      const appliedFadeMs =
        typeof result?.appliedFadeMs === "number"
          ? Math.max(0, result.appliedFadeMs)
          : Math.max(0, fadeOverrideMs ?? firedCue?.fadeInMs ?? 0);
      const previousCueId = typeof result?.previousCueId === "string" ? result.previousCueId : null;
      setSelectedGroupId(null);
      setSelectedCueId(cueId);
      await persistLightingSelectedCue(cueId);
      if (appliedFadeMs > 0) {
        setCueTransitionElapsedMs(0);
        setCueTransition({
          cueId,
          cueLabel: firedCue?.label ?? cueId,
          durationMs: appliedFadeMs,
          previousCueId,
          startedAt: Date.now(),
        });
      } else {
        setCueTransition(null);
        setCueTransitionElapsedMs(0);
      }
      setFeedback({
        message: String(result?.summary ?? `Lighting cue '${cueId}' fired.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue fire failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const recallScene = useEffectEvent(async (actionId: string, sceneId: string, fadeDurationSeconds = 0) => {
    if (patchMode) {
      setFeedback({
        message: "Patch mode is active. Exit patch mode to resume cue output.",
        tone: "info",
      });
      return;
    }

    setBusyAction(actionId);
    setFeedback(null);
    setCueTransition(null);
    setCueTransitionElapsedMs(0);

    try {
      const result = asRecord(await store.recallLightingScene(sceneId, fadeDurationSeconds));
      setSelectedGroupId(null);
      setSelectedCueId(null);
      await persistLightingSelectedCue(null);
      setFeedback({
        message: String(result?.summary ?? `Lighting scene '${sceneId}' recalled.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting scene recall failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const updateLightingSelection = useEffectEvent(
    async (
      actionId: string,
      request: {
        selectedFixtureId?: string | null;
        selectedSceneId?: string | null;
      }
    ) => {
      setBusyAction(actionId);

      try {
        await store.updateLightingSettings(request);
      } catch (error) {
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting selection update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const persistLightingSelectedCue = useEffectEvent(async (cueId: string | null) => {
    try {
      await store.setLightingSelectedCue(cueId);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue selection persist failed.",
        tone: "error",
      });
    }
  });

  const projectLightingPlotPoint = useEffectEvent((clientX: number, clientY: number) => {
    const plotBounds = plotRef.current?.getBoundingClientRect();
    if (!plotBounds || plotBounds.width <= 0 || plotBounds.height <= 0) {
      return null;
    }

    return {
      x: Math.max(0, Math.min(1, (clientX - plotBounds.left) / plotBounds.width)),
      y: Math.max(0, Math.min(1, (clientY - plotBounds.top) / plotBounds.height)),
    };
  });

  const beginLightingFixtureDrag = useEffectEvent(
    (event: ReactMouseEvent<HTMLButtonElement>, fixtureId: string, x: number, y: number) => {
      if (patchMode || event.shiftKey || event.button !== 0) {
        return;
      }

      fixtureDragRef.current = {
        fixtureId,
        lastX: x,
        lastY: y,
        moved: false,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };
      setDragFixturePreview(null);
      event.preventDefault();
      event.stopPropagation();
    }
  );

  const updateLightingFixtureDrag = useEffectEvent((event: MouseEvent) => {
    const dragState = fixtureDragRef.current;
    if (!dragState) {
      return;
    }

    const nextPoint = projectLightingPlotPoint(event.clientX, event.clientY);
    if (!nextPoint) {
      return;
    }

    const moved =
      dragState.moved ||
      Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY) >= 4;
    fixtureDragRef.current = {
      ...dragState,
      lastX: nextPoint.x,
      lastY: nextPoint.y,
      moved,
    };

    if (moved) {
      setDragFixturePreview({
        fixtureId: dragState.fixtureId,
        x: nextPoint.x,
        y: nextPoint.y,
      });
    }
  });

  const finishLightingFixtureDrag = useEffectEvent(async () => {
    const dragState = fixtureDragRef.current;
    if (!dragState) {
      return;
    }

    fixtureDragRef.current = null;
    setDragFixturePreview(null);

    if (!dragState.moved) {
      return;
    }

    suppressFixtureClickRef.current = true;
    window.setTimeout(() => {
      suppressFixtureClickRef.current = false;
    }, 0);

    const movedFixture = fixtures.find((fixture) => fixture.id === dragState.fixtureId) ?? null;
    setBusyAction(`fixture-drag:${dragState.fixtureId}`);
    setFeedback(null);

    try {
      const result = asRecord(
        await store.updateLightingFixture({
          fixtureId: dragState.fixtureId,
          spatialX: dragState.lastX,
          spatialY: dragState.lastY,
        })
      );
      setFeedback({
        message: String(
          result?.summary ?? `Lighting fixture '${movedFixture?.name ?? dragState.fixtureId}' position updated.`
        ),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting fixture drag failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      updateLightingFixtureDrag(event);
    };
    const handleMouseUp = () => {
      void finishLightingFixtureDrag();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [finishLightingFixtureDrag, updateLightingFixtureDrag]);

  const selectLightingSection = useEffectEvent(async (sectionId: string | null) => {
    setCurrentSectionId(sectionId);
    try {
      await store.setLightingSection(sectionId);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting section update failed.",
        tone: "error",
      });
    }
  });

  const beginLightingLasso = useEffectEvent((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!event.shiftKey || patchMode) {
      return;
    }

    const plotBounds = plotRef.current?.getBoundingClientRect();
    if (!plotBounds || plotBounds.width <= 0 || plotBounds.height <= 0) {
      return;
    }

    const startX = (event.clientX - plotBounds.left) / plotBounds.width;
    const startY = (event.clientY - plotBounds.top) / plotBounds.height;
    const nextDraft = {
      startX: Math.max(0, Math.min(1, startX)),
      startY: Math.max(0, Math.min(1, startY)),
      endX: Math.max(0, Math.min(1, startX)),
      endY: Math.max(0, Math.min(1, startY)),
    };
    lassoDraftRef.current = nextDraft;
    setLassoDraft(nextDraft);
    setSelectedGroupId(null);
    event.preventDefault();
  });

  const updateLightingLasso = useEffectEvent((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!lassoDraftRef.current) {
      return;
    }

    const plotBounds = plotRef.current?.getBoundingClientRect();
    if (!plotBounds || plotBounds.width <= 0 || plotBounds.height <= 0) {
      return;
    }

    const endX = (event.clientX - plotBounds.left) / plotBounds.width;
    const endY = (event.clientY - plotBounds.top) / plotBounds.height;
    const nextDraft = {
      ...lassoDraftRef.current,
      endX: Math.max(0, Math.min(1, endX)),
      endY: Math.max(0, Math.min(1, endY)),
    };
    lassoDraftRef.current = nextDraft;
    setLassoDraft(nextDraft);
  });

  const finishLightingLasso = useEffectEvent(async (_event?: ReactMouseEvent<HTMLDivElement>) => {
    const completedDraft = lassoDraftRef.current;
    if (!completedDraft) {
      return;
    }

    const minX = Math.min(completedDraft.startX, completedDraft.endX);
    const maxX = Math.max(completedDraft.startX, completedDraft.endX);
    const minY = Math.min(completedDraft.startY, completedDraft.endY);
    const maxY = Math.max(completedDraft.startY, completedDraft.endY);
    const nextSelectionIds = plottedFixtures
      .filter((fixture) => fixture.x >= minX && fixture.x <= maxX && fixture.y >= minY && fixture.y <= maxY)
      .map((fixture) => fixture.id);

    suppressFixtureClickRef.current = true;
    window.setTimeout(() => {
      suppressFixtureClickRef.current = false;
    }, 0);
    lassoDraftRef.current = null;
    setLassoDraft(null);
    setLassoSelectionIds(nextSelectionIds);
    setSelectedCueId(null);
    await persistLightingSelectedCue(null);
    await store.updateLightingSettings({
      selectedFixtureId: null,
    });
  });

  const saveLassoSelectionAsGroup = useEffectEvent(async () => {
    if (lassoSelectionIds.length < 2) {
      return;
    }

    const groupName = lassoGroupName.trim() || `Group ${groups.length + 1}`;
    setBusyAction("group-create");
    setFeedback(null);

    try {
      const result = asRecord(await store.createLightingGroup(groupName));
      const createdGroup = asRecord(result?.group);
      const createdGroupId = typeof createdGroup?.id === "string" ? createdGroup.id : null;
      if (!createdGroupId) {
        throw new Error("Lighting group create did not return a group id.");
      }

      for (const fixtureId of lassoSelectionIds) {
        await store.updateLightingFixture({
          fixtureId,
          groupId: createdGroupId,
        });
      }

      setSelectedGroupId(createdGroupId);
      setLassoSelectionIds([]);
      setFeedback({
        message: `Lighting group '${groupName}' created from ${lassoSelectionIds.length} selected fixtures.`,
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting group create failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const selectCuePreview = useEffectEvent(async (cueId: string, sceneId?: string) => {
    setSelectedCueId(cueId);
    setCueEditorCueId(null);
    setSelectedGroupId(null);
    setFeedback(null);

    try {
      await persistLightingSelectedCue(cueId);
      await store.updateLightingSettings({
        selectedFixtureId: null,
        selectedSceneId: sceneId ?? null,
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue preview selection failed.",
        tone: "error",
      });
    }
  });

  const selectLightingGroup = useEffectEvent(async (groupId: string) => {
    setFeedback(null);
    setCueEditorCueId(null);

    try {
      await store.updateLightingSettings({
        selectedFixtureId: null,
      });
      setSelectedCueId(null);
      setLassoSelectionIds([]);
      await persistLightingSelectedCue(null);
      setSelectedGroupId(groupId);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting group selection failed.",
        tone: "error",
      });
    }
  });

  const focusLightingScene = useEffectEvent(async (sceneId: string) => {
    setFeedback(null);
    setCueEditorCueId(null);

    try {
      await store.updateLightingSettings({
        selectedFixtureId: null,
        selectedSceneId: sceneId,
      });
      setSelectedCueId(null);
      setLassoSelectionIds([]);
      await persistLightingSelectedCue(null);
      setSelectedGroupId(null);
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting scene focus failed.",
        tone: "error",
      });
    }
  });

  const clearLightingSelection = useEffectEvent(async () => {
    setDmxDrawerOpen(false);
    setPatchMode(false);
    setCueEditorCueId(null);
    setSelectedGroupId(null);
    setSelectedCueId(null);
    setLassoSelectionIds([]);
    setLassoDraft(null);
    lassoDraftRef.current = null;
    setFeedback(null);

    try {
      await persistLightingSelectedCue(null);
      await store.updateLightingSettings({
        selectedFixtureId: null,
        selectedSceneId: null,
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting selection clear failed.",
        tone: "error",
      });
    }
  });

  const openLightingDmxMonitor = useEffectEvent((channelNumber?: number) => {
    const nextChannel = channelNumber ?? dmxPreviewChannels[0]?.channel ?? expandedDmxChannels[0]?.channel ?? null;
    setDmxOverlayChannel(nextChannel);
    setDmxDrawerOpen(true);
  });

  const closeLightingDmxMonitor = useEffectEvent(() => {
    setDmxDrawerOpen(false);
  });

  const focusLightingSceneCapturePrompt = useEffectEvent(() => {
    if (!sceneCaptureAvailable) {
      return;
    }

    setSceneNameDraft((current) => (current.trim() ? current : `Scene ${scenes.length + 1}`));
    window.requestAnimationFrame(() => {
      sceneNameInputRef.current?.focus();
      sceneNameInputRef.current?.select();
    });
  });

  const saveLightingScene = useEffectEvent(async () => {
    if (!sceneCaptureAvailable) {
      return;
    }

    const name = sceneNameDraft.trim() || `Scene ${scenes.length + 1}`;
    setBusyAction("scene-create");
    setFeedback(null);

    try {
      const result = asRecord(
        await store.createLightingScene({
          name,
        })
      );
      setSceneNameDraft("");
      setFeedback({
        message: String(result?.summary ?? `Lighting scene '${name}' was saved from the current fixture state.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting scene save failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const createLightingCue = useEffectEvent(async () => {
    const cueLabel = `Cue ${cues.length + 1}`;
    const linkedSceneId = selectedScene?.id ?? inspectorScene?.id ?? scenes[0]?.id ?? null;
    const afterCueId = selectedCue?.id ?? null;

    setBusyAction("cue-create");
    setFeedback(null);

    try {
      const result = asRecord(
        await store.createLightingCue({
          afterCueId,
          fadeInMs: 1200,
          fadeOutMs: 600,
          label: cueLabel,
          sceneId: linkedSceneId,
        })
      );
      const createdCue = asRecord(result?.cue);
      const createdCueId = typeof createdCue?.id === "string" ? createdCue.id : null;
      if (createdCueId) {
        setSelectedCueId(createdCueId);
        setCueEditorCueId(createdCueId);
        await persistLightingSelectedCue(createdCueId);
        window.requestAnimationFrame(() => {
          cueLabelInputRef.current?.focus();
          cueLabelInputRef.current?.select();
        });
      }
      setFeedback({
        message: String(result?.summary ?? `Lighting cue '${cueLabel}' was added.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue create failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const focusLightingCueEditor = useEffectEvent(() => {
    if (!selectedCue) {
      return;
    }

    setCueEditorCueId(selectedCue.id);
    window.requestAnimationFrame(() => {
      cueLabelInputRef.current?.focus();
      cueLabelInputRef.current?.select();
    });
  });

  const saveLightingCueEdits = useEffectEvent(async () => {
    if (!cueEditorCue) {
      return;
    }

    const label = cueLabelDraft.trim();
    if (!label) {
      setFeedback({
        message: "Cue label is required.",
        tone: "error",
      });
      return;
    }

    setBusyAction("cue-update");
    setFeedback(null);

    try {
      const fadeInMs = Number.parseInt(cueFadeInDraft || "0", 10);
      const fadeOutMs = Number.parseInt(cueFadeOutDraft || "0", 10);
      const followSeconds = cueFollowDraft.trim().length > 0 ? Number.parseFloat(cueFollowDraft) : null;
      const result = asRecord(
        await store.updateLightingCue({
          cueId: cueEditorCue.id,
          fadeInMs: Number.isFinite(fadeInMs) ? fadeInMs : cueEditorCue.fadeInMs,
          fadeOutMs: Number.isFinite(fadeOutMs) ? fadeOutMs : cueEditorCue.fadeOutMs,
          followSeconds: followSeconds !== null && Number.isFinite(followSeconds) ? followSeconds : null,
          label,
          notes: cueNotesDraft.trim() || null,
          sceneId: cueSceneIdDraft || null,
        })
      );
      setFeedback({
        message: String(result?.summary ?? `Lighting cue '${label}' was updated.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue update failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const deleteSelectedLightingCue = useEffectEvent(async () => {
    if (!selectedCue) {
      return;
    }

    const currentIndex = cues.findIndex((cue) => cue.id === selectedCue.id);
    if (currentIndex < 0) {
      return;
    }

    const remainingCues = cues.filter((cue) => cue.id !== selectedCue.id);
    const fallbackCue = remainingCues[currentIndex] ?? remainingCues[currentIndex - 1] ?? remainingCues[0] ?? null;

    setBusyAction("cue-delete");
    setFeedback(null);

    try {
      const result = asRecord(await store.deleteLightingCue(selectedCue.id));
      setCueEditorCueId((current) => (current === selectedCue.id ? null : current));
      setSelectedCueId(fallbackCue?.id ?? null);
      await persistLightingSelectedCue(fallbackCue?.id ?? null);
      setFeedback({
        message: String(result?.summary ?? `Lighting cue '${selectedCue.label}' was deleted.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting cue delete failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const nudgeSelectedFixture = useEffectEvent(async (direction: -1 | 1) => {
    if (!selectedFixture || !selectedPlottedFixture) {
      return;
    }

    const normalizedStep = LIGHTING_NUDGE_METERS / LIGHTING_ROOM_WIDTH_METERS;
    setBusyAction(`fixture-nudge:${selectedFixture.id}`);
    setFeedback(null);

    try {
      const result = asRecord(
        await store.updateLightingFixture({
          fixtureId: selectedFixture.id,
          spatialX: Math.max(0, Math.min(1, selectedPlottedFixture.x + normalizedStep * direction)),
          spatialY: selectedPlottedFixture.y,
        })
      );
      setFeedback({
        message: String(result?.summary ?? `Lighting fixture '${selectedFixture.name}' position updated.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting fixture nudge failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const createLightingFixture = useEffectEvent(async () => {
    const fixtureType = "astra-bicolor";
    const fixtureName = `Fixture ${fixtures.length + 1}`;
    const dmxStartAddress = findNextLightingFixtureStartAddress(fixtures, fixtureType);

    setBusyAction("fixture-create");
    setFeedback(null);

    try {
      const result = asRecord(
        await store.createLightingFixture({
          dmxStartAddress,
          name: fixtureName,
          type: fixtureType,
        })
      );
      const createdFixture = asRecord(result?.fixture);
      const createdFixtureId = typeof createdFixture?.id === "string" ? createdFixture.id : null;
      if (createdFixtureId) {
        await store.updateLightingSettings({
          selectedFixtureId: createdFixtureId,
        });
      }
      setSelectedCueId(null);
      await persistLightingSelectedCue(null);
      setSelectedGroupId(null);
      setFeedback({
        message: String(result?.summary ?? `Lighting fixture '${fixtureName}' was created.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting fixture create failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const setLightingAllPower = useEffectEvent(async (actionId: string, on: boolean) => {
    setBusyAction(actionId);
    setFeedback(null);

    try {
      const result = asRecord(await store.setLightingAllPower(on));
      setSelectedGroupId(null);
      setSelectedCueId(null);
      setFeedback({
        message: String(result?.summary ?? `All native lighting fixtures set ${on ? "on" : "off"}.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting all-power update failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const cancelBlackoutHold = useEffectEvent(() => {
    if (blackoutTimerRef.current !== null) {
      window.clearTimeout(blackoutTimerRef.current);
      blackoutTimerRef.current = null;
    }
    setBlackoutHolding(false);
  });

  const startBlackoutHold = useEffectEvent(() => {
    if (blackoutTimerRef.current !== null || busyAction === "lighting-blackout") {
      return;
    }

    setBlackoutHolding(true);
    blackoutTimerRef.current = window.setTimeout(() => {
      blackoutTimerRef.current = null;
      setBlackoutHolding(false);
      void setLightingAllPower("lighting-blackout", false);
    }, 400);
  });

  const updateFixturePower = useEffectEvent(async (actionId: string, fixtureId: string, on: boolean) => {
    setBusyAction(actionId);
    setFeedback(null);

    try {
      const result = asRecord(await store.updateLightingFixture({ fixtureId, on }));
      setFeedback({
        message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting fixture update failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const updateFixtureIntensity = useEffectEvent(
    async (actionId: string, fixtureId: string, intensity: number, currentIntensity: number) => {
      const nextIntensity = Math.max(0, Math.min(100, Math.round(intensity)));
      if (nextIntensity === currentIntensity) {
        return;
      }

      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = asRecord(await store.updateLightingFixture({ fixtureId, intensity: nextIntensity }));
        setFeedback({
          message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
          tone: "ok",
        });
      } catch (error) {
        setFixtureIntensityDraft(currentIntensity);
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting fixture intensity update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const updateFixtureCct = useEffectEvent(
    async (actionId: string, fixtureId: string, cct: number, currentCct: number, fixtureType: string) => {
      const range = lightingFixtureCctRange(fixtureType);
      const nextCct = Math.max(range.min, Math.min(range.max, Math.round(cct)));
      if (nextCct === currentCct) {
        return;
      }

      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = asRecord(await store.updateLightingFixture({ fixtureId, cct: nextCct }));
        setFeedback({
          message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
          tone: "ok",
        });
      } catch (error) {
        setFixtureCctDraft(currentCct);
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting fixture CCT update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const updateFixturePatch = useEffectEvent(
    async (actionId: string, fixtureId: string, dmxStartAddressDraft: string, currentDmxStartAddress: number) => {
      const trimmed = dmxStartAddressDraft.trim();
      const nextDmxStartAddress = Number(trimmed);
      if (!trimmed || !Number.isFinite(nextDmxStartAddress)) {
        setFixturePatchDraft(String(currentDmxStartAddress));
        setFeedback({
          message: "Lighting fixture patch update requires a whole-number DMX start address.",
          tone: "error",
        });
        return;
      }

      const normalizedDmxStartAddress = Math.round(nextDmxStartAddress);
      if (normalizedDmxStartAddress === currentDmxStartAddress) {
        setFixturePatchDraft(String(currentDmxStartAddress));
        return;
      }

      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = asRecord(
          await store.updateLightingFixture({
            dmxStartAddress: normalizedDmxStartAddress,
            fixtureId,
          })
        );
        setFeedback({
          message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
          tone: "ok",
        });
      } catch (error) {
        setFixturePatchDraft(String(currentDmxStartAddress));
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting fixture patch update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const updateFixtureRigZ = useEffectEvent(
    async (actionId: string, fixtureId: string, nextRigZDraft: string, currentRigZ?: number) => {
      const trimmed = nextRigZDraft.trim();
      const normalizedRigZ =
        trimmed.length === 0 ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : Number.NaN;
      if (Number.isNaN(normalizedRigZ)) {
        setFixtureRigZDraft(typeof currentRigZ === "number" ? String(currentRigZ) : "");
        setFeedback({
          message: "Rig height must be a finite number between 0.0 and 20.0 meters, or blank for auto.",
          tone: "error",
        });
        return;
      }

      if (
        (normalizedRigZ === null && typeof currentRigZ !== "number") ||
        (typeof normalizedRigZ === "number" &&
          typeof currentRigZ === "number" &&
          Math.abs(normalizedRigZ - currentRigZ) < 0.0001)
      ) {
        setFixtureRigZDraft(typeof currentRigZ === "number" ? String(currentRigZ) : "");
        return;
      }

      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = asRecord(
          await store.updateLightingFixture({
            fixtureId,
            rigZ: normalizedRigZ,
          })
        );
        setFeedback({
          message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
          tone: "ok",
        });
      } catch (error) {
        setFixtureRigZDraft(typeof currentRigZ === "number" ? String(currentRigZ) : "");
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting fixture rig height update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const updateFixtureBeamAngle = useEffectEvent(
    async (actionId: string, fixtureId: string, nextBeamAngleDraft: string, currentBeamAngleDegrees?: number) => {
      const trimmed = nextBeamAngleDraft.trim();
      const normalizedBeamAngle =
        trimmed.length === 0 ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : Number.NaN;
      if (Number.isNaN(normalizedBeamAngle)) {
        setFixtureBeamAngleDraft(typeof currentBeamAngleDegrees === "number" ? String(currentBeamAngleDegrees) : "");
        setFeedback({
          message: "Beam angle must be a finite number between 1 and 180 degrees, or blank for the fixture default.",
          tone: "error",
        });
        return;
      }

      if (
        (normalizedBeamAngle === null && typeof currentBeamAngleDegrees !== "number") ||
        (typeof normalizedBeamAngle === "number" &&
          typeof currentBeamAngleDegrees === "number" &&
          Math.abs(normalizedBeamAngle - currentBeamAngleDegrees) < 0.0001)
      ) {
        setFixtureBeamAngleDraft(typeof currentBeamAngleDegrees === "number" ? String(currentBeamAngleDegrees) : "");
        return;
      }

      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = asRecord(
          await store.updateLightingFixture({
            beamAngleDegrees: normalizedBeamAngle,
            fixtureId,
          })
        );
        setFeedback({
          message: String(result?.summary ?? `Lighting fixture '${fixtureId}' updated.`),
          tone: "ok",
        });
      } catch (error) {
        setFixtureBeamAngleDraft(typeof currentBeamAngleDegrees === "number" ? String(currentBeamAngleDegrees) : "");
        setFeedback({
          message: error instanceof Error ? error.message : "Lighting fixture beam angle update failed.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const clearPatchDragState = useEffectEvent(() => {
    setDragPatchStartAddress(null);
    setPatchDropTargetId(null);
  });

  const triggerIdentifyBurst = useEffectEvent((fixtureId: string, fixtureName: string) => {
    if (identifyTimerRef.current !== null) {
      window.clearTimeout(identifyTimerRef.current);
    }
    setIdentifyFixtureId(fixtureId);
    setFeedback({
      message: `Identify burst preview active for '${fixtureName}'.`,
      tone: "info",
    });
    identifyTimerRef.current = window.setTimeout(() => {
      setIdentifyFixtureId((currentFixtureId) => (currentFixtureId === fixtureId ? null : currentFixtureId));
      identifyTimerRef.current = null;
    }, 1200);
  });

  const beginPatchCandidateDrag = useEffectEvent((event: ReactDragEvent<HTMLButtonElement>, startAddress: number) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(startAddress));
    setDragPatchStartAddress(startAddress);
  });

  const applyPatchCandidateToFixture = useEffectEvent(
    async (fixtureId: string, fixtureDmxStartAddress: number, startAddress: number) => {
      if (!Number.isFinite(startAddress)) {
        return;
      }

      if (selectedFixtureId !== fixtureId) {
        setLassoSelectionIds([]);
        setSelectedGroupId(null);
        await updateLightingSelection(`fixture:${fixtureId}`, {
          selectedFixtureId: fixtureId,
          selectedSceneId: selectedSceneId ?? null,
        });
      }

      await updateFixturePatch(
        `fixture-patch:${fixtureId}`,
        fixtureId,
        String(Math.round(startAddress)),
        fixtureDmxStartAddress
      );
    }
  );

  const dropPatchCandidateOnFixture = useEffectEvent(
    async (event: ReactDragEvent<HTMLButtonElement>, fixtureId: string, fixtureDmxStartAddress: number) => {
      event.preventDefault();
      const droppedStartAddress = Number(event.dataTransfer.getData("text/plain"));
      const nextStartAddress = Number.isFinite(droppedStartAddress) ? droppedStartAddress : dragPatchStartAddress;
      clearPatchDragState();
      if (nextStartAddress === null) {
        return;
      }
      await applyPatchCandidateToFixture(fixtureId, fixtureDmxStartAddress, nextStartAddress);
    }
  );

  const setGroupPower = useEffectEvent(async (actionId: string, groupId: string, on: boolean) => {
    setBusyAction(actionId);
    setFeedback(null);

    try {
      const result = asRecord(await store.setLightingGroupPower(groupId, on));
      setFeedback({
        message: String(result?.summary ?? `Lighting group '${groupId}' updated.`),
        tone: "ok",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Lighting group power update failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const moveCueSelection = useEffectEvent(async (offset: -1 | 1) => {
    if (cues.length === 0) {
      return;
    }

    const currentCueId = selectedCueId ?? persistedSelectedCueId ?? activeCue?.id ?? nextCue?.id ?? cues[0]?.id;
    const currentIndex = Math.max(
      0,
      cues.findIndex((cue) => cue.id === currentCueId)
    );
    const nextIndex = Math.max(0, Math.min(cues.length - 1, currentIndex + offset));
    const cue = cues[nextIndex];
    if (!cue) {
      return;
    }

    await selectCuePreview(cue.id, cue.sceneId);
  });

  const requestSelectedCueFire = useEffectEvent(() => {
    if (!selectedCue) {
      return;
    }

    const activeOrdinal = activeCue?.ordinal ?? selectedCue.ordinal;
    if (Math.abs(selectedCue.ordinal - activeOrdinal) > 2) {
      setPendingCueJumpId(selectedCue.id);
      return;
    }

    void fireCue("cue-selected", selectedCue.id, selectedCue.fadeInMs);
  });

  const confirmSelectedCueJump = useEffectEvent(() => {
    if (!pendingCueJumpId) {
      return;
    }

    const cue = cues.find((entry) => entry.id === pendingCueJumpId) ?? null;
    setPendingCueJumpId(null);
    if (!cue) {
      return;
    }

    void fireCue("cue-selected", cue.id, cue.fadeInMs);
  });

  useEffect(() => () => cancelBlackoutHold(), [cancelBlackoutHold]);

  useEffect(() => {
    const handleLightingKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Escape" && pendingCueJumpId !== null) {
        setPendingCueJumpId(null);
        event.preventDefault();
        return;
      }

      if (event.key === "Escape" && dmxDrawerOpen) {
        closeLightingDmxMonitor();
        event.preventDefault();
        return;
      }

      if (
        event.key === "Escape" &&
        (lassoDraft !== null ||
          lassoSelectionIds.length > 0 ||
          patchMode ||
          dmxDrawerOpen ||
          selectedGroupId !== null ||
          selectedFixtureId !== null ||
          selectedSceneId !== null ||
          selectedCueId !== null)
      ) {
        void clearLightingSelection();
        event.preventDefault();
        return;
      }

      if (event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (nextCue) {
          void fireCue("cue-go", nextCue.id, nextCue.fadeInMs);
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (previousCue) {
          void fireCue("cue-back", previousCue.id, previousCue.fadeInMs);
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowUp") {
        void moveCueSelection(-1);
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowDown") {
        void moveCueSelection(1);
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Enter") {
        if (selectedCue) {
          requestSelectedCueFire();
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowLeft") {
        if (selectedFixture) {
          void nudgeSelectedFixture(-1);
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowRight") {
        if (selectedFixture) {
          void nudgeSelectedFixture(1);
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        void createLightingCue();
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "e") {
        if (selectedCue) {
          focusLightingCueEditor();
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        void createLightingFixture();
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "0") {
        void selectLightingSection(null);
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
        const nextSection = lightingSections.find((section) => section.key === event.key) ?? null;
        if (nextSection) {
          void selectLightingSection(nextSection.id);
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g") {
        if (lassoSelectionIds.length > 1) {
          void saveLassoSelectionAsGroup();
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        if (sceneCaptureAvailable) {
          focusLightingSceneCapturePrompt();
          event.preventDefault();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "m") {
        if (dmxDrawerOpen) {
          closeLightingDmxMonitor();
        } else {
          openLightingDmxMonitor();
        }
        event.preventDefault();
        return;
      }

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.key.toLowerCase() === "b"
      ) {
        startBlackoutHold();
        event.preventDefault();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
        setPatchMode((current) => !current);
        event.preventDefault();
      }
    };

    const handleLightingKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        cancelBlackoutHold();
      }
    };

    window.addEventListener("keydown", handleLightingKeyDown);
    window.addEventListener("keyup", handleLightingKeyUp);
    return () => {
      window.removeEventListener("keydown", handleLightingKeyDown);
      window.removeEventListener("keyup", handleLightingKeyUp);
    };
  }, [
    cancelBlackoutHold,
    clearLightingSelection,
    lassoDraft,
    lassoSelectionIds.length,
    patchMode,
    pendingCueJumpId,
    dmxDrawerOpen,
    fireCue,
    createLightingCue,
    createLightingFixture,
    focusLightingCueEditor,
    closeLightingDmxMonitor,
    focusLightingSceneCapturePrompt,
    groupStates,
    inspectorScene?.id,
    saveLassoSelectionAsGroup,
    lightingSections,
    moveCueSelection,
    nudgeSelectedFixture,
    openLightingDmxMonitor,
    previousCue,
    persistedSelectedCueId,
    requestSelectedCueFire,
    scenes,
    sceneCaptureAvailable,
    selectLightingSection,
    selectedCueId,
    selectedCue,
    selectedFixture?.groupId,
    selectedFixtureId,
    selectedGroupId,
    selectedScene?.id,
    selectedSceneId,
    selectLightingGroup,
    startBlackoutHold,
  ]);

  if (!lightingSnapshotLoaded) {
    return (
      <div className={styles.lightingShell}>
        <section className={`${styles.workspaceCard} ${styles.lightingToolbar}`}>
          <div className={styles.lightingToolbarCluster}>
            <div>
              <div className={styles.metaLabel}>Lighting</div>
              <h2 className={styles.cardTitle}>Lighting workspace</h2>
              <p className={styles.cardSubtitle}>Loading the lighting snapshot from the engine.</p>
            </div>
            <StatusBadge label="loading" tone="connected" />
          </div>
          <div className={styles.lightingToolbarCluster}>
            <StatusBadge label={`u${universe} · ${bridgeIp}`} tone="idle" />
          </div>
        </section>

        <div className={styles.lightingMain}>
          <aside className={`${styles.workspaceCard} ${styles.lightingCueRail}`}>
            <div className={styles.lightingCueRailHeader}>
              <div className={styles.metaLabel}>Cue Rail</div>
              <div className={styles.footerNote}>Awaiting snapshot</div>
            </div>
            <div className={styles.lightingGoBar}>
              <div className={styles.lightingGoMeta}>
                <div className={styles.summaryValue}>Loading cue stack…</div>
                <div className={styles.summaryDetail}>Run-of-show metadata is still hydrating.</div>
              </div>
            </div>
            <div className={styles.lightingCueList} aria-hidden="true">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={styles.lightingLoadingCueRow} />
              ))}
            </div>
          </aside>

          <section className={`${styles.workspaceCard} ${styles.lightingStageSurface}`}>
            <div className={styles.lightingPlotCard}>
              <div className={styles.lightingPlotHeader}>
                <div>
                  <div className={styles.metaLabel}>Stage preview</div>
                  <div className={styles.summaryDetail}>
                    Outline and grid are available before the live fixture layer arrives.
                  </div>
                </div>
              </div>
              <div className={styles.lightingPlot} data-patch="false">
                <div className={styles.lightingPlotFrame} />
                <div className={styles.lightingStageLabel}>STAGE</div>
                {Array.from({ length: 3 }, (_, index) => {
                  const fallback = fallbackFixturePosition(index);
                  return (
                    <div
                      key={index}
                      className={styles.lightingLoadingFixture}
                      style={{
                        left: `${Math.max(6, Math.min(94, fallback.x * 100))}%`,
                        top: `${Math.max(10, Math.min(90, fallback.y * 100))}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </section>

          <aside className={`${styles.workspaceCard} ${styles.lightingInspector}`}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Cue preview</div>
              <div className={styles.metaValue}>Loading…</div>
              <div className={styles.lightingLoadingInspector}>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className={styles.lightingLoadingInspectorBar} />
                ))}
              </div>
            </div>
          </aside>
        </div>

        <section className={`${styles.workspaceCard} ${styles.lightingControlStrip}`}>
          <div className={styles.lightingStripColumn}>
            <div className={styles.metaLabel}>Groups</div>
            <div className={styles.footerNote}>Waiting for published group pads.</div>
          </div>
          <div className={styles.lightingStripColumn}>
            <div className={styles.metaLabel}>Scenes</div>
            <div className={styles.footerNote}>Waiting for published scene recall tiles.</div>
          </div>
          <div className={styles.lightingStripColumn}>
            <div className={styles.lightingStripHeader}>
              <div className={styles.metaLabel}>DMX peek</div>
              <div className={styles.footerNote}>Blank ribbon until the DMX monitor snapshot arrives.</div>
            </div>
            <div className={styles.lightingDmxGrid} data-stale="false" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className={`${styles.lightingDmxCell} ${styles.lightingLoadingDmxCell}`} />
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      <div className={styles.lightingShell}>
        <section className={`${styles.workspaceCard} ${styles.lightingToolbar}`}>
          <div className={styles.lightingToolbarCluster}>
            <div>
              <div className={styles.metaLabel}>Lighting</div>
              <h2 className={styles.cardTitle}>Lighting workspace</h2>
              <p className={styles.cardSubtitle}>
                {String(
                  lightingSnapshot?.summary ?? "Engine-driven lighting state is now routed into the replacement shell."
                )}
              </p>
            </div>
            <StatusBadge label={status} tone={mapStatusBadgeTone(lightingStatusTone(status))} />
          </div>
          <div className={styles.lightingToolbarCluster}>
            <StatusBadge label={dmxStale ? "DMX unreachable" : "DMX linked"} tone={dmxStale ? "error" : "connected"} />
            <StatusBadge label={`u${universe} · ${bridgeIp}`} tone={dmxStale ? "warning" : "idle"} />
          </div>
          <div className={styles.lightingToolbarStats}>
            <span className={styles.lightingToolbarStatChip}>Fixtures {fixtures.length}</span>
            <span className={styles.lightingToolbarStatChip}>On {onCount}</span>
            <span className={styles.lightingToolbarStatChip}>Groups {groups.length}</span>
            <span className={styles.lightingToolbarStatChip}>Cues {cues.length}</span>
          </div>
          <label className={styles.lightingToolbarSearch}>
            <span className={styles.lightingToolbarSearchLabel}>Search</span>
            <input
              className={styles.lightingToolbarInput}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search fixtures"
              type="search"
              value={searchQuery}
            />
          </label>
          <div className={styles.lightingToolbarActions}>
            {searchActive ? (
              <Button onClick={() => setSearchQuery("")} size="compact" variant="ghost">
                Clear
              </Button>
            ) : null}
            <Button
              onClick={() => setPatchMode((current) => !current)}
              size="compact"
              variant={patchMode ? "primary" : "secondary"}
            >
              Patch
            </Button>
            <Button
              aria-pressed={blackoutHolding}
              className={styles.lightingBlackoutButton}
              onMouseDown={startBlackoutHold}
              onMouseLeave={cancelBlackoutHold}
              onMouseUp={cancelBlackoutHold}
              onPointerDown={startBlackoutHold}
              onPointerLeave={cancelBlackoutHold}
              onPointerUp={cancelBlackoutHold}
              onTouchEnd={cancelBlackoutHold}
              onTouchStart={startBlackoutHold}
              size="compact"
              variant="danger"
            >
              {blackoutHolding ? "Hold blackout…" : "Blackout"}
            </Button>
            <Button
              disabled={busyAction === "fixture-create"}
              onClick={() => void createLightingFixture()}
              size="compact"
              variant="primary"
            >
              + Fixture
            </Button>
          </div>
        </section>

        {feedback ? (
          <div className={styles.statusBanner} role="status">
            <div>
              <div className={styles.statusBannerTitle}>
                {feedback.tone === "error" ? "Lighting action failed" : "Lighting action applied"}
              </div>
              <div className={styles.statusBannerBody}>{feedback.message}</div>
            </div>
            <StatusBadge label={feedback.tone} tone={feedbackBadgeTone(feedback.tone)} />
          </div>
        ) : null}

        <div className={styles.lightingMain}>
          <aside className={`${styles.workspaceCard} ${styles.lightingCueRail}`}>
            <div className={styles.lightingCueRailHeader}>
              <div className={styles.metaLabel}>Cue Rail</div>
              <div className={styles.footerNote}>{cues.length} cues</div>
            </div>
            <div
              className={styles.lightingGoBar}
              data-testid="lighting-go-bar"
              data-transitioning={cueTransition !== null}
            >
              {cueTransition ? (
                <div
                  aria-hidden="true"
                  className={styles.lightingGoProgress}
                  data-testid="lighting-go-progress"
                  style={{ width: `${Math.max(0, Math.min(100, cueTransitionProgress * 100))}%` }}
                />
              ) : null}
              <div className={styles.lightingGoMeta}>
                <div className={styles.summaryValue}>
                  {cueTransition ? `GOING → ${cueTransition.cueLabel}` : cueTarget ? cueTarget.label : "No cue ready"}
                </div>
                <div className={styles.summaryDetail}>
                  {cueTransition
                    ? `${cueTransitionPreviousCue ? `From ${cueTransitionPreviousCue.label}` : "Cross-fade in progress."} · ${Math.round(
                        cueTransitionProgress * 100
                      )}%`
                    : cueOutputMuted
                      ? "Patch mode is active. Cue output is muted until you leave commissioning."
                      : dmxStale
                        ? "No DMX — connect bridge."
                        : `${activeCue ? `Active: ${activeCue.label}` : "No active cue."}${
                            nextCue && nextCue.id !== activeCue?.id ? ` Next: ${nextCue.label}.` : ""
                          }`}
                </div>
              </div>
              <div className={styles.lightingGoActions}>
                <Button
                  disabled={!previousCue || busyAction === "cue-back" || cueOutputMuted}
                  onClick={() => previousCue && void fireCue("cue-back", previousCue.id, previousCue.fadeInMs)}
                  variant="secondary"
                >
                  BACK
                </Button>
                <Button
                  disabled={!nextCue || busyAction === "cue-go" || dmxStale || cueOutputMuted}
                  onClick={() => nextCue && void fireCue("cue-go", nextCue.id, nextCue.fadeInMs)}
                  variant="primary"
                >
                  GO
                </Button>
              </div>
            </div>
            <div className={styles.lightingCueList}>
              {cues.length > 0 ? (
                cues.map((cue) => (
                  <button
                    key={cue.id}
                    className={styles.lightingCueItem}
                    data-active={cue.id === activeCue?.id}
                    data-selected={cue.id === selectedCue?.id}
                    onClick={() => void selectCuePreview(cue.id, cue.sceneId)}
                    type="button"
                  >
                    <div className={styles.lightingCueRow}>
                      <div>
                        <div className={styles.lightingCueLabel}>
                          {cue.ordinal}. {cue.label}
                        </div>
                        <div className={styles.lightingCueDetail}>
                          Fade in {cue.fadeInMs} ms
                          {cue.followSeconds !== undefined ? ` · Follow ${cue.followSeconds}s` : ""}
                        </div>
                      </div>
                      <StatusBadge label={cue.state} tone={lightingCueTone(cue.state)} />
                    </div>
                  </button>
                ))
              ) : (
                <div className={styles.footerNote}>No lighting cues are published yet.</div>
              )}
            </div>
            <div className={styles.actionRow}>
              <Button
                disabled={busyAction === "cue-create"}
                onClick={() => void createLightingCue()}
                size="compact"
                variant="ghost"
              >
                + Cue
              </Button>
              <Button
                disabled={!selectedCue || cueEditorBusy}
                onClick={() => focusLightingCueEditor()}
                size="compact"
                variant="secondary"
              >
                Edit cue
              </Button>
              <Button
                disabled={!selectedCue || cueEditorBusy}
                onClick={() => void deleteSelectedLightingCue()}
                size="compact"
                variant="danger"
              >
                Delete cue
              </Button>
            </div>
            <div className={styles.footerNote}>
              Space GO · Backspace BACK · ↑/↓ cue · Enter fire · C add cue · E edit cue · ←/→ nudge fixture · Shift+drag
              lasso · G save group
            </div>
          </aside>

          <section className={`${styles.workspaceCard} ${styles.lightingStageSurface}`}>
            <div className={styles.lightingPlotCard}>
              <div className={styles.lightingPlotHeader}>
                <div>
                  <div className={styles.metaLabel}>Stage preview</div>
                  <div className={styles.summaryDetail}>
                    {patchMode
                      ? "Patch mode is active. Select a fixture to edit addresses in-place."
                      : activeSection
                        ? `${activeSection.label} section active. Non-section fixtures are dimmed until section view is cleared.`
                        : "Fixture positions come straight from `lighting.snapshot`."}
                  </div>
                </div>
                <div className={styles.footerNote}>
                  Bridge {bridgeIp} · Universe {universe}
                </div>
              </div>
              <div
                ref={plotRef}
                className={styles.lightingPlot}
                data-cue-pulse={cueTransitionPulseActive}
                data-testid="lighting-stage-plot"
                data-patch={patchMode}
                data-lasso-active={lassoDraft ? "true" : "false"}
                onMouseDown={beginLightingLasso}
                onMouseMove={updateLightingLasso}
                onMouseUp={(event) => void finishLightingLasso(event)}
                onMouseLeave={() => {
                  if (lassoDraft) {
                    void finishLightingLasso();
                  }
                }}
              >
                <div className={styles.lightingPlotFrame} />
                <div className={styles.lightingStageLabel}>STAGE</div>
                {activeSection ? (
                  <div className={styles.lightingSectionPill}>
                    {activeSection.key}. {activeSection.label}
                  </div>
                ) : null}
                {patchMode ? <div className={styles.lightingPatchBanner}>Patch mode · output muted</div> : null}
                {patchMode ? (
                  <div className={styles.lightingPatchOverlay}>
                    <div className={styles.lightingPatchOverlayHeader}>
                      <div className={styles.metaLabel}>Candidate DMX starts</div>
                      <div className={styles.summaryDetail}>
                        {selectedFixture
                          ? `Selected fixture: ${selectedFixture.name}. Drag a safe start address onto any fixture, or click to apply it to the current target.`
                          : "Select a fixture, then drag a safe start address onto the stage target you want to re-patch."}
                      </div>
                    </div>
                    {patchCandidateStartAddresses.length > 0 ? (
                      <div className={styles.lightingPatchCandidateGrid}>
                        {patchCandidateStartAddresses.map((startAddress) => (
                          <button
                            key={startAddress}
                            aria-label={`Patch candidate DMX ${startAddress}`}
                            className={styles.lightingPatchCandidate}
                            data-dragging={dragPatchStartAddress === startAddress}
                            draggable
                            onClick={() => {
                              if (!selectedFixture) {
                                return;
                              }
                              void applyPatchCandidateToFixture(
                                selectedFixture.id,
                                selectedFixture.dmxStartAddress,
                                startAddress
                              );
                            }}
                            onDragEnd={() => clearPatchDragState()}
                            onDragStart={(event) => beginPatchCandidateDrag(event, startAddress)}
                            title={`Universe ${universe} · start ${String(startAddress).padStart(3, "0")}`}
                            type="button"
                          >
                            <span className={styles.lightingPatchCandidateAddress}>
                              {String(startAddress).padStart(3, "0")}
                            </span>
                            <span className={styles.lightingPatchCandidateMeta}>safe start</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.footerNote}>
                        No safe start addresses are currently available in Universe {universe}.
                      </div>
                    )}
                  </div>
                ) : null}
                {!patchMode
                  ? stageFixtures
                      .filter((fixture) => fixture.displayOn)
                      .map((fixture) => {
                        const beamAngle = lightingFixtureBeamAngle(fixture.type, fixture.beamAngleDegrees);
                        const beamLength = lightingFixtureBeamLength(fixture.kind);
                        return (
                          <div
                            aria-hidden="true"
                            className={styles.lightingBeamCone}
                            data-testid={`lighting-beam-${fixture.id}`}
                            key={`${fixture.id}:beam`}
                            style={{
                              background: `linear-gradient(180deg, color-mix(in srgb, ${lightingFixtureColor(
                                fixture.displayCct,
                                true
                              )} ${Math.round(lightingFixtureBeamOpacity(fixture.displayIntensity, fixture.displayOn) * 100)}%, transparent), transparent)`,
                              height: `${beamLength}%`,
                              left: `${Math.max(6, Math.min(94, fixture.x * 100))}%`,
                              opacity: lightingFixtureBeamOpacity(fixture.displayIntensity, fixture.displayOn),
                              top: `${Math.max(10, Math.min(90, fixture.y * 100))}%`,
                              transform: `translate(-50%, -100%) rotate(${fixture.spatialRotation}deg)`,
                              width: `${lightingFixtureBeamWidth(beamAngle, beamLength)}%`,
                            }}
                          />
                        );
                      })
                  : null}
                {!patchMode
                  ? stageMarkers.map((marker) => (
                      <div
                        aria-label={`${marker.label} marker`}
                        className={styles.lightingStageMarker}
                        data-testid={`lighting-stage-marker-${marker.id}`}
                        key={marker.id}
                        style={{
                          left: `${Math.max(6, Math.min(94, marker.x * 100))}%`,
                          top: `${Math.max(10, Math.min(90, marker.y * 100))}%`,
                          transform: `translate(-50%, -50%) rotate(${marker.rotation}deg)`,
                        }}
                        title={`${marker.label} marker`}
                      >
                        <span>{marker.id === "camera" ? "CAM" : "SUBJ"}</span>
                      </div>
                    ))
                  : null}
                {stageFixtures.length > 0 ? (
                  stageFixtures.map((fixture) => {
                    const patchOverlap = patchOverlapByFixtureId.get(fixture.id) ?? null;
                    const displayX = dragFixturePreview?.fixtureId === fixture.id ? dragFixturePreview.x : fixture.x;
                    const displayY = dragFixturePreview?.fixtureId === fixture.id ? dragFixturePreview.y : fixture.y;
                    return (
                      <button
                        aria-label={`Select fixture ${fixture.name}`}
                        aria-pressed={selectedFixtureId === fixture.id}
                        key={fixture.id}
                        className={styles.lightingFixture}
                        data-active={selectedFixtureId === fixture.id}
                        data-display-intensity={fixture.displayIntensity}
                        data-display-on={fixture.displayOn}
                        data-dragging={dragFixturePreview?.fixtureId === fixture.id}
                        data-dimmed={searchActive && !fixture.matchesSearch}
                        data-lasso-selected={lassoSelectionIds.includes(fixture.id)}
                        data-identify-active={identifyFixtureId === fixture.id}
                        data-patch-drop-target={patchDropTargetId === fixture.id}
                        data-patch-overlap={patchMode && patchOverlap !== null}
                        data-section-dimmed={!fixture.inActiveSection}
                        data-stale={dmxStale}
                        disabled={busyAction === `fixture:${fixture.id}`}
                        onClick={() => {
                          if (suppressFixtureClickRef.current) {
                            return;
                          }
                          setLassoSelectionIds([]);
                          setSelectedGroupId(null);
                          void updateLightingSelection(`fixture:${fixture.id}`, {
                            selectedFixtureId: fixture.id,
                          });
                        }}
                        onDragEnter={() => {
                          if (!patchMode || dragPatchStartAddress === null) {
                            return;
                          }
                          setPatchDropTargetId(fixture.id);
                        }}
                        onDragLeave={() => {
                          if (patchDropTargetId === fixture.id) {
                            setPatchDropTargetId(null);
                          }
                        }}
                        onDragOver={(event) => {
                          if (!patchMode || dragPatchStartAddress === null) {
                            return;
                          }
                          event.preventDefault();
                          if (patchDropTargetId !== fixture.id) {
                            setPatchDropTargetId(fixture.id);
                          }
                        }}
                        onMouseDown={(event) => beginLightingFixtureDrag(event, fixture.id, fixture.x, fixture.y)}
                        onDrop={(event) => void dropPatchCandidateOnFixture(event, fixture.id, fixture.dmxStartAddress)}
                        style={{
                          background: lightingFixtureColor(fixture.displayCct, fixture.displayOn),
                          left: `${Math.max(6, Math.min(94, displayX * 100))}%`,
                          opacity: (() => {
                            const baseOpacity =
                              searchActive && !fixture.matchesSearch ? 0.2 : !fixture.inActiveSection ? 0.3 : 1;
                            if (!patchMode) {
                              return cueTransition !== null
                                ? baseOpacity *
                                    lightingFixtureStageFadeOpacity(fixture.displayIntensity, fixture.displayOn)
                                : baseOpacity;
                            }
                            if (patchDropTargetId === fixture.id || selectedFixtureId === fixture.id) {
                              return baseOpacity;
                            }
                            return Math.min(baseOpacity, 0.4);
                          })(),
                          top: `${Math.max(10, Math.min(90, displayY * 100))}%`,
                        }}
                        title={fixture.name}
                        type="button"
                      >
                        <span className={styles.lightingFixtureLabel}>
                          {patchMode
                            ? lightingFixturePatchSummary(fixture.dmxStartAddress, fixture.type)
                            : fixture.name}
                        </span>
                        {patchMode && patchOverlap !== null ? (
                          <span className={styles.lightingFixtureWarning}>
                            {formatLightingPatchOverlapStageLabel(patchOverlap.conflictingFixtureNames)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className={styles.lightingEmptyState}>
                    <div>No fixture positions are available yet. Add the first fixture to begin patching.</div>
                    <div className={styles.actionRow}>
                      <Button
                        disabled={busyAction === "fixture-create"}
                        onClick={() => void createLightingFixture()}
                        variant="primary"
                      >
                        + Fixture
                      </Button>
                    </div>
                  </div>
                )}
                {lassoDraft ? (
                  <div
                    className={styles.lightingLasso}
                    style={{
                      left: `${Math.min(lassoDraft.startX, lassoDraft.endX) * 100}%`,
                      top: `${Math.min(lassoDraft.startY, lassoDraft.endY) * 100}%`,
                      width: `${Math.abs(lassoDraft.endX - lassoDraft.startX) * 100}%`,
                      height: `${Math.abs(lassoDraft.endY - lassoDraft.startY) * 100}%`,
                    }}
                  />
                ) : null}
                {searchActive && searchHitCount === 0 ? (
                  <div className={styles.lightingSearchEmptyState}>
                    <span>
                      Search: "{searchQuery}" · 0 of {fixtures.length}
                    </span>
                    <Button onClick={() => setSearchQuery("")} size="compact" variant="ghost">
                      Clear
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <aside className={`${styles.workspaceCard} ${styles.lightingInspector}`}>
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Inspector</div>
              <div className={styles.metaValue}>
                {patchMode && !selectedFixture
                  ? "Patch mode"
                  : selectedFixture
                    ? selectedFixture.name
                    : selectedCue
                      ? selectedCue.label
                      : selectedScene
                        ? selectedScene.name
                        : "Nothing selected"}
              </div>
              <div className={styles.footerNote}>
                {patchMode && !selectedFixture
                  ? "Select a fixture on the stage to edit DMX addresses."
                  : selectedFixture
                    ? `Type ${selectedFixture.type} · DMX ${selectedFixture.dmxStartAddress}`
                    : selectedCue
                      ? `Fade in ${selectedCue.fadeInMs} ms · Fade out ${selectedCue.fadeOutMs} ms`
                      : selectedScene
                        ? `Scene fixture count ${selectedScene.fixtureCount}`
                        : "Lighting selection will become richer as the workspace migration expands."}
              </div>
            </div>
            {patchMode ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Patch</div>
                <div className={styles.metaValue}>{selectedFixture ? selectedFixture.name : "Select a fixture"}</div>
                <div className={styles.summaryDetail}>
                  {selectedFixture
                    ? `Type ${selectedFixture.type} · ${lightingFixturePatchSummary(
                        selectedFixture.dmxStartAddress,
                        selectedFixture.type
                      )}`
                    : "Patch mode keeps the stage visible while DMX ranges and address edits stay in view."}
                </div>
                {selectedFixture ? (
                  <>
                    <div className={styles.lightingPatchFacts}>
                      <div className={styles.lightingPatchFact}>
                        <div className={styles.summaryValue}>Universe {universe}</div>
                        <div className={styles.footerNote}>sACN target</div>
                      </div>
                      <div className={styles.lightingPatchFact}>
                        <div className={styles.summaryValue}>
                          {String(selectedFixture.dmxStartAddress).padStart(3, "0")}-
                          {String(
                            selectedFixture.dmxStartAddress + lightingFixtureChannelCount(selectedFixture.type) - 1
                          ).padStart(3, "0")}
                        </div>
                        <div className={styles.footerNote}>Start ch</div>
                      </div>
                      <div className={styles.lightingPatchFact}>
                        <div className={styles.summaryValue}>{lightingFixtureModeLabel(selectedFixture.type)}</div>
                        <div className={styles.footerNote}>Mode</div>
                      </div>
                      <div className={styles.lightingPatchFact}>
                        <div className={styles.summaryValue}>{formatLightingRigHeight(selectedFixture.rigZ)}</div>
                        <div className={styles.footerNote}>Rig height</div>
                      </div>
                      <div className={styles.lightingPatchFact}>
                        <div className={styles.summaryValue}>
                          {formatLightingBeamAngleValue(selectedFixture.type, selectedFixture.beamAngleDegrees)}
                        </div>
                        <div className={styles.footerNote}>Beam angle</div>
                      </div>
                    </div>
                    {selectedFixturePatchOverlap ? (
                      <div className={styles.lightingPatchConflictCard}>
                        <div className={styles.lightingPatchConflictLabel}>Patch collision</div>
                        <div className={styles.summaryDetail}>
                          {selectedFixture.name} overlaps{" "}
                          {selectedFixturePatchOverlap.conflictingFixtureNames.join(", ")} at{" "}
                          {lightingFixturePatchSummary(selectedFixture.dmxStartAddress, selectedFixture.type)}.
                        </div>
                        {selectedFixturePatchOverlap.suggestedStartAddress !== null &&
                        selectedFixturePatchOverlap.suggestedEndAddress !== null ? (
                          <div className={styles.actionRow}>
                            <Button
                              disabled={busyAction === `fixture-patch:${selectedFixture.id}`}
                              onClick={() =>
                                void updateFixturePatch(
                                  `fixture-patch:${selectedFixture.id}`,
                                  selectedFixture.id,
                                  String(selectedFixturePatchOverlap.suggestedStartAddress),
                                  selectedFixture.dmxStartAddress
                                )
                              }
                              variant="secondary"
                            >
                              Auto-fix to DMX {selectedFixturePatchOverlap.suggestedStartAddress}
                            </Button>
                            <span className={styles.footerNote}>
                              Safe range {String(selectedFixturePatchOverlap.suggestedStartAddress).padStart(3, "0")}-
                              {String(selectedFixturePatchOverlap.suggestedEndAddress).padStart(3, "0")}
                            </span>
                          </div>
                        ) : (
                          <div className={styles.footerNote}>
                            No conflict-free start channel is currently available in Universe {universe}.
                          </div>
                        )}
                      </div>
                    ) : null}
                    {selectedFixturePatchRows.length > 0 ? (
                      <div className={styles.lightingPatchTable} role="list">
                        {selectedFixturePatchRows.map((row) => (
                          <div
                            key={`${selectedFixture.id}:${row.channel}`}
                            className={styles.lightingPatchRow}
                            role="listitem"
                            title={`${row.label} · ${String(row.channel).padStart(3, "0")} · ${row.value}`}
                          >
                            <span className={styles.lightingPatchAddress}>{String(row.channel).padStart(3, "0")}</span>
                            <div className={styles.lightingPatchBar}>
                              {Array.from({ length: 8 }, (_, index) => (
                                <span
                                  key={index}
                                  className={styles.lightingPatchSegment}
                                  data-active={index < lightingPatchBarSegments(row.value)}
                                />
                              ))}
                            </div>
                            <span className={styles.lightingPatchValue}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.lightingPatchEditor}>
                      <label className={styles.lightingPatchField}>
                        <span className={styles.lightingPatchFieldLabel}>Start channel</span>
                        <input
                          aria-label="Fixture patch start channel"
                          className={styles.lightingPatchInput}
                          disabled={busyAction === `fixture-patch:${selectedFixture.id}`}
                          inputMode="numeric"
                          max={selectedFixtureMaxStartAddress}
                          min={1}
                          onChange={(event) => setFixturePatchDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void updateFixturePatch(
                                `fixture-patch:${selectedFixture.id}`,
                                selectedFixture.id,
                                event.currentTarget.value,
                                selectedFixture.dmxStartAddress
                              );
                            }
                            if (event.key === "Escape") {
                              setFixturePatchDraft(String(selectedFixture.dmxStartAddress));
                            }
                          }}
                          type="number"
                          value={fixturePatchDraft}
                        />
                      </label>
                      <Button
                        disabled={
                          busyAction === `fixture-patch:${selectedFixture.id}` ||
                          fixturePatchDraft.trim() === String(selectedFixture.dmxStartAddress)
                        }
                        onClick={() =>
                          void updateFixturePatch(
                            `fixture-patch:${selectedFixture.id}`,
                            selectedFixture.id,
                            fixturePatchDraft,
                            selectedFixture.dmxStartAddress
                          )
                        }
                        variant="secondary"
                      >
                        Apply patch
                      </Button>
                    </div>
                    <div className={styles.footerNote}>
                      Universe {universe} · max start {selectedFixtureMaxStartAddress} ·{" "}
                      {lightingFixtureChannelCount(selectedFixture.type)} channels
                    </div>
                    <div className={styles.actionRow}>
                      <Button
                        disabled={identifyFixtureId === selectedFixture.id}
                        onClick={() => triggerIdentifyBurst(selectedFixture.id, selectedFixture.name)}
                        variant="secondary"
                      >
                        Identify burst
                      </Button>
                      <span className={styles.footerNote}>
                        Preview the selected fixture on the stage before committing address edits.
                      </span>
                    </div>
                    <div className={styles.lightingPatchEditor}>
                      <label className={styles.lightingPatchField}>
                        <span className={styles.lightingPatchFieldLabel}>Rig height (m)</span>
                        <input
                          aria-label="Fixture rig height"
                          className={styles.lightingPatchInput}
                          disabled={busyAction === `fixture-rig-z:${selectedFixture.id}`}
                          inputMode="decimal"
                          max={20}
                          min={0}
                          onChange={(event) => setFixtureRigZDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void updateFixtureRigZ(
                                `fixture-rig-z:${selectedFixture.id}`,
                                selectedFixture.id,
                                event.currentTarget.value,
                                selectedFixture.rigZ
                              );
                            }
                            if (event.key === "Escape") {
                              setFixtureRigZDraft(
                                typeof selectedFixture.rigZ === "number" ? String(selectedFixture.rigZ) : ""
                              );
                            }
                          }}
                          placeholder="Auto"
                          step="0.1"
                          type="number"
                          value={fixtureRigZDraft}
                        />
                      </label>
                      <Button
                        disabled={
                          busyAction === `fixture-rig-z:${selectedFixture.id}` ||
                          fixtureRigZDraft.trim() ===
                            (typeof selectedFixture.rigZ === "number" ? String(selectedFixture.rigZ) : "")
                        }
                        onClick={() =>
                          void updateFixtureRigZ(
                            `fixture-rig-z:${selectedFixture.id}`,
                            selectedFixture.id,
                            fixtureRigZDraft,
                            selectedFixture.rigZ
                          )
                        }
                        variant="secondary"
                      >
                        Apply height
                      </Button>
                    </div>
                    <div className={styles.footerNote}>
                      Blank resets to the fixture default. Native range 0.0-20.0 m.
                    </div>
                    <div className={styles.lightingPatchEditor}>
                      <label className={styles.lightingPatchField}>
                        <span className={styles.lightingPatchFieldLabel}>Beam angle (deg)</span>
                        <input
                          aria-label="Fixture beam angle"
                          className={styles.lightingPatchInput}
                          disabled={busyAction === `fixture-beam-angle:${selectedFixture.id}`}
                          inputMode="decimal"
                          max={180}
                          min={1}
                          onChange={(event) => setFixtureBeamAngleDraft(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void updateFixtureBeamAngle(
                                `fixture-beam-angle:${selectedFixture.id}`,
                                selectedFixture.id,
                                event.currentTarget.value,
                                selectedFixture.beamAngleDegrees
                              );
                            }
                            if (event.key === "Escape") {
                              setFixtureBeamAngleDraft(
                                typeof selectedFixture.beamAngleDegrees === "number"
                                  ? String(selectedFixture.beamAngleDegrees)
                                  : ""
                              );
                            }
                          }}
                          placeholder={`Auto (${formatLightingBeamAngleValue(selectedFixture.type)})`}
                          step="1"
                          type="number"
                          value={fixtureBeamAngleDraft}
                        />
                      </label>
                      <Button
                        disabled={
                          busyAction === `fixture-beam-angle:${selectedFixture.id}` ||
                          fixtureBeamAngleDraft.trim() ===
                            (typeof selectedFixture.beamAngleDegrees === "number"
                              ? String(selectedFixture.beamAngleDegrees)
                              : "")
                        }
                        onClick={() =>
                          void updateFixtureBeamAngle(
                            `fixture-beam-angle:${selectedFixture.id}`,
                            selectedFixture.id,
                            fixtureBeamAngleDraft,
                            selectedFixture.beamAngleDegrees
                          )
                        }
                        variant="secondary"
                      >
                        Apply beam
                      </Button>
                    </div>
                    <div className={styles.footerNote}>
                      Blank resets to the fixture default. Native range 1-180 degrees.
                    </div>
                  </>
                ) : (
                  <div className={styles.footerNote}>
                    Press `P` or click Patch again to leave commissioning overlay mode.
                  </div>
                )}
              </div>
            ) : selectedFixture ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Fixture controls</div>
                <div className={styles.summaryDetail}>
                  {selectedFixture.on ? "Live" : "Standby"} at {selectedFixture.intensity}% / {selectedFixture.cct}K
                </div>
                <div className={styles.footerNote}>
                  {groups.find((group) => group.id === selectedFixture.groupId)?.name ?? "Ungrouped"} ·{" "}
                  {selectedFixture.kind}
                </div>
                <div className={styles.actionRow}>
                  <Button
                    disabled={busyAction === `fixture-power:${selectedFixture.id}`}
                    onClick={() =>
                      void updateFixturePower(
                        `fixture-power:${selectedFixture.id}`,
                        selectedFixture.id,
                        !selectedFixture.on
                      )
                    }
                    variant={selectedFixture.on ? "secondary" : "primary"}
                  >
                    {selectedFixture.on ? "Turn fixture off" : "Turn fixture on"}
                  </Button>
                </div>
                <div className={styles.lightingParam}>
                  <div className={styles.lightingParamHeader}>
                    <span className={styles.lightingParamLabel}>Intensity</span>
                    <span className={styles.lightingParamValue}>
                      {Math.max(0, Math.min(100, Math.round(fixtureIntensityDraft ?? selectedFixture.intensity)))}%
                    </span>
                  </div>
                  <div className={styles.lightingParamSlider}>
                    <div
                      aria-hidden="true"
                      className={styles.lightingParamFill}
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(100, Math.round(fixtureIntensityDraft ?? selectedFixture.intensity))
                        )}%`,
                      }}
                    />
                    <div aria-hidden="true" className={styles.lightingParamMarks}>
                      {Array.from({ length: 21 }, (_, index) => (
                        <span key={index} />
                      ))}
                    </div>
                    <input
                      aria-label="Fixture intensity"
                      className={styles.lightingParamRange}
                      disabled={busyAction === `fixture-intensity:${selectedFixture.id}`}
                      max={100}
                      min={0}
                      onBlur={(event) =>
                        void updateFixtureIntensity(
                          `fixture-intensity:${selectedFixture.id}`,
                          selectedFixture.id,
                          Number(event.currentTarget.value),
                          selectedFixture.intensity
                        )
                      }
                      onChange={(event) => setFixtureIntensityDraft(Number(event.currentTarget.value))}
                      onKeyUp={(event) => {
                        if (isLightingRangeCommitKey(event.key)) {
                          void updateFixtureIntensity(
                            `fixture-intensity:${selectedFixture.id}`,
                            selectedFixture.id,
                            Number(event.currentTarget.value),
                            selectedFixture.intensity
                          );
                        }
                      }}
                      onPointerUp={(event) =>
                        void updateFixtureIntensity(
                          `fixture-intensity:${selectedFixture.id}`,
                          selectedFixture.id,
                          Number(event.currentTarget.value),
                          selectedFixture.intensity
                        )
                      }
                      step={1}
                      type="range"
                      value={Math.max(0, Math.min(100, Math.round(fixtureIntensityDraft ?? selectedFixture.intensity)))}
                    />
                  </div>
                </div>
                <div className={styles.lightingParam}>
                  <div className={styles.lightingParamHeader}>
                    <span className={styles.lightingParamLabel}>CCT</span>
                    <span className={styles.lightingParamValue}>
                      {Math.max(
                        selectedFixtureCctRange.min,
                        Math.min(selectedFixtureCctRange.max, Math.round(fixtureCctDraft ?? selectedFixture.cct))
                      )}
                      K
                    </span>
                  </div>
                  <div className={styles.lightingParamSlider}>
                    <div
                      aria-hidden="true"
                      className={`${styles.lightingParamFill} ${styles.lightingParamFillCct}`}
                      style={{
                        width: `${lightingFixtureCctPercent(
                          fixtureCctDraft ?? selectedFixture.cct,
                          selectedFixture.type
                        )}%`,
                      }}
                    />
                    <div aria-hidden="true" className={styles.lightingParamMarks}>
                      {Array.from({ length: 7 }, (_, index) => (
                        <span key={index} />
                      ))}
                    </div>
                    <input
                      aria-label="Fixture CCT"
                      className={styles.lightingParamRange}
                      disabled={busyAction === `fixture-cct:${selectedFixture.id}`}
                      max={selectedFixtureCctRange.max}
                      min={selectedFixtureCctRange.min}
                      onBlur={(event) =>
                        void updateFixtureCct(
                          `fixture-cct:${selectedFixture.id}`,
                          selectedFixture.id,
                          Number(event.currentTarget.value),
                          selectedFixture.cct,
                          selectedFixture.type
                        )
                      }
                      onChange={(event) => setFixtureCctDraft(Number(event.currentTarget.value))}
                      onKeyUp={(event) => {
                        if (isLightingRangeCommitKey(event.key)) {
                          void updateFixtureCct(
                            `fixture-cct:${selectedFixture.id}`,
                            selectedFixture.id,
                            Number(event.currentTarget.value),
                            selectedFixture.cct,
                            selectedFixture.type
                          );
                        }
                      }}
                      onPointerUp={(event) =>
                        void updateFixtureCct(
                          `fixture-cct:${selectedFixture.id}`,
                          selectedFixture.id,
                          Number(event.currentTarget.value),
                          selectedFixture.cct,
                          selectedFixture.type
                        )
                      }
                      step={100}
                      type="range"
                      value={Math.max(
                        selectedFixtureCctRange.min,
                        Math.min(selectedFixtureCctRange.max, Math.round(fixtureCctDraft ?? selectedFixture.cct))
                      )}
                    />
                  </div>
                </div>
                <div className={styles.lightingParam}>
                  <div className={styles.lightingParamHeader}>
                    <span className={styles.lightingParamLabel}>DMX patch</span>
                    <span className={styles.lightingParamValue}>
                      {lightingFixturePatchSummary(selectedFixture.dmxStartAddress, selectedFixture.type)}
                    </span>
                  </div>
                  {selectedFixturePatchRows.length > 0 ? (
                    <div className={styles.lightingPatchTable} role="list">
                      {selectedFixturePatchRows.map((row) => (
                        <div
                          key={`${selectedFixture.id}:${row.channel}`}
                          className={styles.lightingPatchRow}
                          role="listitem"
                          title={`${row.label} · ${String(row.channel).padStart(3, "0")} · ${row.value}`}
                        >
                          <span className={styles.lightingPatchAddress}>{String(row.channel).padStart(3, "0")}</span>
                          <div className={styles.lightingPatchBar}>
                            {Array.from({ length: 8 }, (_, index) => (
                              <span
                                key={index}
                                className={styles.lightingPatchSegment}
                                data-active={index < lightingPatchBarSegments(row.value)}
                              />
                            ))}
                          </div>
                          <span className={styles.lightingPatchValue}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.lightingPatchEditor}>
                    <label className={styles.lightingPatchField}>
                      <span className={styles.lightingPatchFieldLabel}>Start channel</span>
                      <input
                        aria-label="Fixture patch start channel"
                        className={styles.lightingPatchInput}
                        disabled={busyAction === `fixture-patch:${selectedFixture.id}`}
                        inputMode="numeric"
                        max={selectedFixtureMaxStartAddress}
                        min={1}
                        onChange={(event) => setFixturePatchDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void updateFixturePatch(
                              `fixture-patch:${selectedFixture.id}`,
                              selectedFixture.id,
                              event.currentTarget.value,
                              selectedFixture.dmxStartAddress
                            );
                          }
                          if (event.key === "Escape") {
                            setFixturePatchDraft(String(selectedFixture.dmxStartAddress));
                          }
                        }}
                        type="number"
                        value={fixturePatchDraft}
                      />
                    </label>
                    <Button
                      disabled={
                        busyAction === `fixture-patch:${selectedFixture.id}` ||
                        fixturePatchDraft.trim() === String(selectedFixture.dmxStartAddress)
                      }
                      onClick={() =>
                        void updateFixturePatch(
                          `fixture-patch:${selectedFixture.id}`,
                          selectedFixture.id,
                          fixturePatchDraft,
                          selectedFixture.dmxStartAddress
                        )
                      }
                      variant="secondary"
                    >
                      Apply patch
                    </Button>
                  </div>
                  <div className={styles.footerNote}>
                    Universe {universe} · max start {selectedFixtureMaxStartAddress} ·{" "}
                    {lightingFixtureChannelCount(selectedFixture.type)} channels
                  </div>
                </div>
                <div className={styles.lightingParam}>
                  <div className={styles.lightingParamHeader}>
                    <span className={styles.lightingParamLabel}>Groups</span>
                    <span className={styles.lightingParamValue}>
                      {selectedFixtureGroups.length} membership{selectedFixtureGroups.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className={styles.lightingChipRow}>
                    {selectedFixtureGroups.length > 0 ? (
                      selectedFixtureGroups.map((group) => (
                        <span key={group.id} className={styles.lightingChip}>
                          <span>{group.name}</span>
                          <span className={styles.lightingChipMeta}>{group.fixtureCount}</span>
                        </span>
                      ))
                    ) : (
                      <div className={styles.footerNote}>No lighting groups are assigned to this fixture.</div>
                    )}
                  </div>
                </div>
                <div className={styles.lightingParam}>
                  <div className={styles.lightingParamHeader}>
                    <span className={styles.lightingParamLabel}>In cues</span>
                    <span className={styles.lightingParamValue}>
                      {selectedFixtureCueMemberships.length} cue{selectedFixtureCueMemberships.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className={styles.lightingChipRow}>
                    {selectedFixtureCueMemberships.length > 0 ? (
                      selectedFixtureCueMemberships.map((cue) => (
                        <span key={cue.id} className={styles.lightingChip} data-active={cue.id === activeCue?.id}>
                          <span>
                            {cue.ordinal}. {cue.label}
                          </span>
                          <span className={styles.lightingChipMeta}>{cue.state}</span>
                        </span>
                      ))
                    ) : (
                      <div className={styles.footerNote}>No cue memberships are published for this fixture.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {!selectedFixture && lassoGroupState ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Group controls</div>
                <div className={styles.metaValue}>{lassoGroupState.fixtureCount} fixtures selected</div>
                <div className={styles.footerNote}>
                  {lassoGroupState.onFixtureCount}/{lassoGroupState.fixtureCount} on · intensity{" "}
                  {formatLightingValueRange(lassoGroupState.intensityMin, lassoGroupState.intensityMax, "%")} · CCT{" "}
                  {formatLightingValueRange(lassoGroupState.cctMin, lassoGroupState.cctMax, "K")}
                </div>
                <div className={styles.lightingChipRow}>
                  {lassoGroupState.fixtures.map((fixture) => (
                    <span key={`lasso:${fixture.id}`} className={styles.lightingChip} data-active={fixture.on}>
                      <span>{fixture.name}</span>
                      <span className={styles.lightingChipMeta}>{fixture.on ? `${fixture.intensity}%` : "OFF"}</span>
                    </span>
                  ))}
                </div>
                <div className={styles.lightingPatchEditor}>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Group name</span>
                    <input
                      aria-label="Lasso group name"
                      className={styles.lightingPatchInput}
                      disabled={busyAction === "group-create"}
                      onChange={(event) => setLassoGroupName(event.currentTarget.value)}
                      value={lassoGroupName}
                    />
                  </label>
                  <Button
                    disabled={busyAction === "group-create"}
                    onClick={() => void saveLassoSelectionAsGroup()}
                    variant="ghost"
                  >
                    Save as Group…
                  </Button>
                </div>
                <div className={styles.summaryDetail}>
                  Average output {lassoGroupState.averageIntensity}% · {lassoGroupState.averageCct}K
                  {lassoGroupState.mixed ? " · Mixed values published" : ""}
                </div>
              </div>
            ) : !selectedFixture && selectedGroup ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Group controls</div>
                <div className={styles.metaValue}>{selectedGroup.name}</div>
                <div className={styles.footerNote}>
                  {selectedGroup.onFixtureCount}/{selectedGroup.fixtureCount} on · intensity{" "}
                  {formatLightingValueRange(selectedGroup.intensityMin, selectedGroup.intensityMax, "%")} · CCT{" "}
                  {formatLightingValueRange(selectedGroup.cctMin, selectedGroup.cctMax, "K")}
                </div>
                <div className={styles.lightingChipRow}>
                  {selectedGroup.fixtures.map((fixture) => (
                    <span
                      key={`${selectedGroup.id}:${fixture.id}`}
                      className={styles.lightingChip}
                      data-active={fixture.on}
                    >
                      <span>{fixture.name}</span>
                      <span className={styles.lightingChipMeta}>{fixture.on ? `${fixture.intensity}%` : "OFF"}</span>
                    </span>
                  ))}
                </div>
                <div className={styles.actionRow}>
                  <Button
                    disabled={busyAction === `group:${selectedGroup.id}`}
                    onClick={() =>
                      void setGroupPower(`group:${selectedGroup.id}`, selectedGroup.id, !selectedGroup.allOn)
                    }
                    variant={selectedGroup.allOn ? "secondary" : "primary"}
                  >
                    {selectedGroup.allOn ? "Turn group off" : "Turn group on"}
                  </Button>
                </div>
                <div className={styles.summaryDetail}>
                  Average output {selectedGroup.averageIntensity}% · {selectedGroup.averageCct}K
                  {selectedGroup.mixed ? " · Mixed values published" : ""}
                </div>
              </div>
            ) : !selectedFixture && cueEditorCue && cueEditorCue.id === selectedCue?.id ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Cue edit</div>
                <div className={styles.metaValue}>
                  Cue {cueEditorCue.ordinal}. {cueEditorCue.label}
                </div>
                <div className={styles.lightingPatchEditor}>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Cue label</span>
                    <input
                      aria-label="Cue label"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      onChange={(event) => setCueLabelDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void saveLightingCueEdits();
                        }
                      }}
                      ref={cueLabelInputRef}
                      value={cueLabelDraft}
                    />
                  </label>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Scene</span>
                    <select
                      aria-label="Cue scene"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      onChange={(event) => setCueSceneIdDraft(event.currentTarget.value)}
                      value={cueSceneIdDraft}
                    >
                      <option value="">No linked scene</option>
                      {scenes.map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className={styles.lightingPatchEditor}>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Fade in (ms)</span>
                    <input
                      aria-label="Cue fade in"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      inputMode="numeric"
                      onChange={(event) => setCueFadeInDraft(event.currentTarget.value)}
                      type="number"
                      value={cueFadeInDraft}
                    />
                  </label>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Fade out (ms)</span>
                    <input
                      aria-label="Cue fade out"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      inputMode="numeric"
                      onChange={(event) => setCueFadeOutDraft(event.currentTarget.value)}
                      type="number"
                      value={cueFadeOutDraft}
                    />
                  </label>
                </div>
                <div className={styles.lightingPatchEditor}>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Follow (s)</span>
                    <input
                      aria-label="Cue follow seconds"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      inputMode="decimal"
                      onChange={(event) => setCueFollowDraft(event.currentTarget.value)}
                      placeholder="Optional"
                      type="number"
                      value={cueFollowDraft}
                    />
                  </label>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Notes</span>
                    <input
                      aria-label="Cue notes"
                      className={styles.lightingPatchInput}
                      disabled={cueEditorBusy}
                      onChange={(event) => setCueNotesDraft(event.currentTarget.value)}
                      value={cueNotesDraft}
                    />
                  </label>
                </div>
                <div className={styles.actionRow}>
                  <Button disabled={cueEditorBusy} onClick={() => void saveLightingCueEdits()} variant="secondary">
                    Apply cue edits
                  </Button>
                </div>
                <div className={styles.footerNote}>Shortcut `E` focuses cue editing for the selected cue.</div>
              </div>
            ) : !selectedFixture && inspectorCue ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Cue preview</div>
                <div className={styles.metaValue}>
                  Cue {inspectorCue.ordinal}. {inspectorCue.label}
                </div>
                <div className={styles.footerNote}>
                  fade {formatLightingCueFadeSeconds(inspectorCue.fadeInMs)} · {inspectorCueDeltaRows.length} fixture
                  change
                  {inspectorCueDeltaRows.length === 1 ? "" : "s"}
                </div>
                {inspectorCueDeltaRows.length > 0 ? (
                  <div className={styles.lightingCueDeltaList}>
                    {inspectorCueDeltaRows.map((row) => (
                      <div
                        key={`${inspectorCue.id}:${row.fixtureId}`}
                        className={styles.lightingCueDeltaRow}
                        data-direction={row.direction}
                        title={`${row.fixtureName} ${row.fromLabel} → ${row.toLabel}`}
                      >
                        <span className={styles.lightingCueDeltaFixture}>{row.fixtureName}</span>
                        <span className={styles.lightingCueDeltaValue}>{row.fromLabel}</span>
                        <span className={styles.lightingCueDeltaArrow}>→</span>
                        <span className={styles.lightingCueDeltaValue}>{row.toLabel}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.summaryDetail}>
                    {inspectorCue.notes ?? "No fixture level changes are published for this cue preview."}
                  </div>
                )}
                <div className={styles.actionRow}>
                  <Button
                    disabled={busyAction === "cue-selected" || cueOutputMuted}
                    onClick={() => focusLightingCueEditor()}
                    variant="ghost"
                  >
                    Edit cue
                  </Button>
                  <Button
                    disabled={busyAction === "cue-selected" || cueOutputMuted}
                    onClick={() => void fireCue("cue-selected", inspectorCue.id, inspectorCue.fadeInMs)}
                    variant="primary"
                  >
                    Fire selected cue
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Cue action</div>
                <div className={styles.summaryDetail}>
                  {selectedCue?.notes ?? "Select a cue from the rail to inspect or fire it directly."}
                </div>
                <div className={styles.actionRow}>
                  <Button
                    disabled={!selectedCue || busyAction === "cue-selected" || cueOutputMuted}
                    onClick={() => selectedCue && void fireCue("cue-selected", selectedCue.id, selectedCue.fadeInMs)}
                    variant="primary"
                  >
                    Fire selected cue
                  </Button>
                </div>
              </div>
            )}
            {!patchMode && sceneCaptureAvailable ? (
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Save scene</div>
                <div className={styles.summaryDetail}>
                  {sceneCaptureSelectionLabel} active. Save the current rig state as a reusable scene.
                </div>
                <div className={styles.lightingPatchEditor}>
                  <label className={styles.lightingPatchField}>
                    <span className={styles.lightingPatchFieldLabel}>Scene name</span>
                    <input
                      aria-label="Lighting scene name"
                      className={styles.lightingPatchInput}
                      disabled={busyAction === "scene-create"}
                      onChange={(event) => setSceneNameDraft(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveLightingScene();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setSceneNameDraft(`Scene ${scenes.length + 1}`);
                          sceneNameInputRef.current?.blur();
                        }
                      }}
                      ref={sceneNameInputRef}
                      value={sceneNameDraft}
                    />
                  </label>
                  <Button
                    disabled={busyAction === "scene-create"}
                    onClick={() => void saveLightingScene()}
                    variant="secondary"
                  >
                    Save scene
                  </Button>
                </div>
                <div className={styles.footerNote}>Shortcut `S` focuses the scene name prompt.</div>
              </div>
            ) : null}
            <div className={styles.metaItem}>
              <div className={styles.metaLabel}>Scene and transport</div>
              <div className={styles.metaGrid}>
                <div>
                  <div className={styles.summaryValue}>{inspectorScene?.name ?? "No linked scene"}</div>
                  <div className={styles.footerNote}>Selected scene</div>
                </div>
                <div>
                  <div className={styles.summaryValue}>{String(lightingSnapshot?.adapterMode ?? "unknown")}</div>
                  <div className={styles.footerNote}>Adapter mode</div>
                </div>
                <div>
                  <div className={styles.summaryValue}>{scenes.length}</div>
                  <div className={styles.footerNote}>Scenes</div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <section className={`${styles.workspaceCard} ${styles.lightingControlStrip}`}>
          <div className={styles.lightingStripColumn}>
            <div className={styles.metaLabel}>Groups</div>
            <div className={styles.lightingChipRow}>
              {groupStates.length > 0 ? (
                groupStates.map((group) => (
                  <button
                    key={group.id}
                    className={styles.lightingGroupChip}
                    data-active={group.id === selectedGroup?.id}
                    data-power={group.allOn ? "on" : group.mixed ? "mixed" : "off"}
                    disabled={group.fixtureCount === 0}
                    onClick={() => void selectLightingGroup(group.id)}
                    type="button"
                  >
                    <span>{group.name}</span>
                    <span className={styles.lightingChipMeta}>
                      {group.onFixtureCount}/{group.fixtureCount} on
                    </span>
                  </button>
                ))
              ) : (
                <div className={styles.footerNote}>No lighting groups are published yet.</div>
              )}
            </div>
          </div>

          <div className={styles.lightingStripColumn}>
            <div className={styles.lightingStripHeader}>
              <div className={styles.metaLabel}>Scenes</div>
              <div className={styles.footerNote}>{selectedScene?.name ?? "Select a scene or cue"}</div>
            </div>
            <div className={styles.lightingChipRow}>
              {scenes.length > 0 ? (
                scenes.map((scene) => (
                  <button
                    key={scene.id}
                    className={styles.lightingSceneChip}
                    data-active={scene.lastRecalled || scene.id === selectedScene?.id}
                    disabled={busyAction === `scene:${scene.id}` || cueOutputMuted}
                    onClick={() => void recallScene(`scene:${scene.id}`, scene.id, 0)}
                    type="button"
                  >
                    <span>{scene.name}</span>
                    <span className={styles.lightingChipMeta}>{scene.fixtureCount}</span>
                  </button>
                ))
              ) : (
                <div className={styles.footerNote}>No scenes are available for recall yet.</div>
              )}
            </div>
          </div>

          <div className={styles.lightingStripColumn}>
            <div className={styles.lightingStripHeader}>
              <div className={styles.metaLabel}>DMX peek</div>
              <div className={styles.lightingStripActions}>
                <div className={styles.footerNote}>{dmxStale ? `Stale · ${dmxPreviewLabel}` : dmxPreviewLabel}</div>
                <Button onClick={() => openLightingDmxMonitor()} size="compact" variant="ghost">
                  Expand
                </Button>
              </div>
            </div>
            {dmxPreviewChannels.length > 0 ? (
              <div className={styles.lightingDmxGrid} data-stale={dmxStale}>
                {dmxPreviewChannels.map((channel) => (
                  <button
                    aria-label={`Open DMX channel ${channel.channel}`}
                    key={`${channel.channel}:${channel.label}`}
                    className={styles.lightingDmxCell}
                    onClick={() => openLightingDmxMonitor(channel.channel)}
                    title={`${channel.lightName} · ${channel.label}`}
                    type="button"
                  >
                    <span className={styles.lightingDmxChannel}>{String(channel.channel).padStart(3, "0")}</span>
                    <span className={styles.lightingDmxValue}>{formatDmxValue(channel.value)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.footerNote}>No DMX monitor channels are published yet.</div>
            )}
          </div>
        </section>

        {dmxDrawerOpen ? (
          <div className={styles.overlay} role="presentation">
            <Surface
              aria-labelledby="lighting-dmx-monitor-title"
              aria-modal="true"
              className={styles.dmxOverlayCard}
              padding="lg"
              role="dialog"
              tone="raised"
            >
              <div className={styles.dmxOverlayHeader}>
                <div>
                  <div className={styles.metaLabel} id="lighting-dmx-monitor-title">
                    DMX monitor
                  </div>
                  <div className={styles.footerNote}>
                    Full-universe overlay · first 88 channels · Ctrl+M opens, Esc closes
                  </div>
                </div>
                <Button onClick={() => closeLightingDmxMonitor()} size="compact" variant="ghost">
                  Close
                </Button>
              </div>
              {selectedDmxOverlayChannel ? (
                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLabel}>Channel</div>
                    <div className={styles.metaValue}>{String(selectedDmxOverlayChannel.channel).padStart(3, "0")}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLabel}>Label</div>
                    <div className={styles.metaValue}>{selectedDmxOverlayChannel.label}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLabel}>Fixture</div>
                    <div className={styles.metaValue}>{selectedDmxOverlayChannel.lightName}</div>
                  </div>
                  <div className={styles.metaItem}>
                    <div className={styles.metaLabel}>Value</div>
                    <div className={styles.metaValue}>{formatDmxValue(selectedDmxOverlayChannel.value)}</div>
                  </div>
                </div>
              ) : null}
              <div className={styles.lightingDmxDrawerGrid}>
                {expandedDmxChannels.map((channel) => (
                  <button
                    aria-label={`Inspect DMX channel ${channel.channel}`}
                    key={`drawer:${channel.channel}`}
                    className={styles.lightingDmxDrawerCell}
                    data-active={selectedDmxOverlayChannel?.channel === channel.channel}
                    onClick={() => setDmxOverlayChannel(channel.channel)}
                    title={`${channel.lightName} · ${channel.label}`}
                    type="button"
                  >
                    <span className={styles.lightingDmxChannel}>{String(channel.channel).padStart(3, "0")}</span>
                    <span className={styles.lightingDmxValue}>{formatDmxValue(channel.value)}</span>
                    <span className={styles.lightingDmxDrawerLabel}>{channel.label}</span>
                  </button>
                ))}
              </div>
            </Surface>
          </div>
        ) : null}
      </div>
      {pendingCueJump ? (
        <ShellDialog
          body={`Cue ${pendingCueJump.ordinal}. ${pendingCueJump.label} is more than two steps away from the active cue. Confirm the jump before firing it live.`}
          confirmLabel="Fire jump cue"
          onCancel={() => setPendingCueJumpId(null)}
          onConfirm={confirmSelectedCueJump}
          title="Jump to selected cue?"
        />
      ) : null}
    </>
  );
}

export function OperatorShell() {
  const environment = useMemo(() => createShellEnvironment(), []);
  const shellState = useShellSnapshot(environment.store);
  useTauriShellTestBridge(shellState, environment.store);
  const activeWorkspace = shellState.activeWorkspace;
  const setupModalActive = activeWorkspace === "setup";
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent>(null);
  const [showShortcutGuide, setShowShortcutGuide] = useState(false);
  const deferredLightingDmxMonitorSnapshot = useDeferredValue(shellState.lightingDmxMonitorSnapshot);
  const deferredLightingSnapshot = useDeferredValue(shellState.lightingSnapshot);
  const deferredAudioSnapshot = useDeferredValue(shellState.audioSnapshot);
  const deferredPlanningSnapshot = useDeferredValue(shellState.planningSnapshot);
  const deferredSupportSnapshot = useDeferredValue(shellState.supportSnapshot);

  const requestRestart = useEffectEvent(() => {
    setConfirmIntent("restart-engine");
  });

  const showShortcuts = useEffectEvent(() => {
    setShowShortcutGuide(true);
  });

  const performRestart = useEffectEvent(async () => {
    setConfirmIntent(null);
    await environment.store.restart();
  });

  useEffect(() => {
    void environment.store.initialize();

    return () => {
      void environment.store.dispose();
    };
  }, [environment.store]);

  const workspaces = useMemo(
    () =>
      [
        { id: "setup", label: "Setup / Support", meta: "pilot" },
        { id: "lighting", label: "Lighting", meta: "primary" },
        { id: "audio", label: "Audio", meta: "primary" },
        { id: "planning", label: "Planning", meta: "secondary" },
      ] as const,
    []
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        if (confirmIntent) {
          setConfirmIntent(null);
          event.preventDefault();
          return;
        }

        if (showShortcutGuide) {
          setShowShortcutGuide(false);
          event.preventDefault();
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === "s") {
        if (activeWorkspace !== "setup") {
          void environment.store.setWorkspace("setup");
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        if (activeWorkspace !== "audio") {
          void environment.store.setWorkspace("audio");
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && activeWorkspace === "planning") {
        if (event.key.toLowerCase() === "b") {
          void environment.store.updatePlanningSettings({ modeSection: "board" });
          event.preventDefault();
          return;
        }

        if (event.key.toLowerCase() === "t") {
          void environment.store.updatePlanningSettings({ modeSection: "timeline" });
          event.preventDefault();
          return;
        }
      }

      if (
        (event.key === "?" || (event.key === "/" && event.shiftKey)) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        setShowShortcutGuide((current) => !current);
        event.preventDefault();
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && ["1", "2", "3", "4"].includes(event.key)) {
        const nextWorkspace = workspaces[Number(event.key) - 1]?.id;
        if (nextWorkspace) {
          void environment.store.setWorkspace(nextWorkspace);
          event.preventDefault();
        }
        return;
      }

      if (modifier && event.shiftKey && event.key.toLowerCase() === "r") {
        setConfirmIntent("restart-engine");
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkspace, confirmIntent, environment.store, showShortcutGuide, workspaces]);

  const shellExperience = deriveShellExperience(shellState);

  if (setupModalActive && shellExperience === "startup") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupStartupSurface appSnapshot={shellState.appSnapshot} onShowShortcuts={showShortcuts} />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge clears the current shell session and repeats the startup handshake."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (shellExperience === "startup") {
    return (
      <>
        <StartupSurface lifecycle={shellState.lifecycle} onShowShortcuts={showShortcuts} />
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge clears the current shell session and repeats the startup handshake."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (setupModalActive && shellExperience === "ready") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupSupportPilot
              appSnapshot={shellState.appSnapshot}
              commissioningSnapshot={shellState.commissioningSnapshot}
              controlSurfaceSnapshot={shellState.controlSurfaceSnapshot}
              healthSnapshot={shellState.healthSnapshot}
              liveTransportRequested={environment.liveTransportRequested}
              onRequestRestart={requestRestart}
              onShowShortcuts={showShortcuts}
              store={environment.store}
              supportSnapshot={deferredSupportSnapshot}
            />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge closes the current shell session, re-runs protocol negotiation, and reloads commissioning/support state."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (setupModalActive && shellExperience === "recovery") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupRecoverySurface
              appSnapshot={shellState.appSnapshot}
              failure={shellState.startupFailure}
              healthSnapshot={shellState.healthSnapshot}
              liveTransportRequested={environment.liveTransportRequested}
              onRequestRestart={requestRestart}
              onShowShortcuts={showShortcuts}
              store={environment.store}
              supportSnapshot={deferredSupportSnapshot}
            />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Retry startup with the current runtime paths. If the failure persists, capture diagnostics before changing persistence or protocol state."
            confirmLabel="Retry startup"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Retry startup?"
          />
        ) : null}
      </>
    );
  }

  if (shellExperience === "recovery") {
    return (
      <>
        <RecoverySurface
          failure={shellState.startupFailure}
          healthSnapshot={shellState.healthSnapshot}
          onRequestRestart={requestRestart}
          onShowShortcuts={showShortcuts}
        />
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Retry startup with the current runtime paths. If the failure persists, capture diagnostics before changing persistence or protocol state."
            confirmLabel="Retry startup"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Retry startup?"
          />
        ) : null}
      </>
    );
  }

  const monitorItems = buildMonitorItems(shellState.healthSnapshot);
  const contextSections = buildContextSections(
    activeWorkspace,
    shellState.commissioningSnapshot,
    deferredSupportSnapshot,
    deferredLightingSnapshot
  );

  const degradedSummary =
    shellState.recovery === "degraded" &&
    !setupModalActive &&
    activeWorkspace !== "lighting" &&
    activeWorkspace !== "audio" &&
    activeWorkspace !== "planning"
      ? String(shellState.healthSnapshot?.summary ?? "Hardware or bridge attention required.")
      : null;
  const frameContextSections =
    activeWorkspace === "lighting" || activeWorkspace === "audio" || activeWorkspace === "planning"
      ? []
      : contextSections;
  const hideFrameMainHeader =
    activeWorkspace === "lighting" || activeWorkspace === "audio" || activeWorkspace === "planning";

  const body =
    activeWorkspace === "setup" ? (
      <SetupSupportPilot
        appSnapshot={shellState.appSnapshot}
        commissioningSnapshot={shellState.commissioningSnapshot}
        controlSurfaceSnapshot={shellState.controlSurfaceSnapshot}
        healthSnapshot={shellState.healthSnapshot}
        liveTransportRequested={environment.liveTransportRequested}
        onRequestRestart={requestRestart}
        onShowShortcuts={showShortcuts}
        store={environment.store}
        supportSnapshot={deferredSupportSnapshot}
      />
    ) : activeWorkspace === "lighting" ? (
      <LightingWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        lightingDmxMonitorSnapshot={deferredLightingDmxMonitorSnapshot}
        lightingSnapshot={deferredLightingSnapshot}
        store={environment.store}
      />
    ) : activeWorkspace === "audio" ? (
      <AudioWorkspace
        appSnapshot={shellState.appSnapshot}
        audioSnapshot={deferredAudioSnapshot}
        store={environment.store}
      />
    ) : activeWorkspace === "planning" ? (
      <PlanningWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        planningSnapshot={deferredPlanningSnapshot}
        store={environment.store}
      />
    ) : (
      <GraphicsWorkspace
        title="Planning workbench"
        subtitle="Secondary planning surface in a sidecar posture rather than a co-equal operator workspace."
        note="Planning migrates last and stays secondary to lighting and audio."
      />
    );

  return (
    <>
      <AppShellFrame
        activeWorkspace={activeWorkspace}
        eyebrow={environment.liveTransportRequested ? "Live transport" : `Fixture ${environment.fixtureId}`}
        hideMainHeader={hideFrameMainHeader}
        monitorItems={monitorItems}
        subtitle={
          shellState.errorSummary ?? String(shellState.appSnapshot?.summary ?? "Story-first operator shell foundation.")
        }
        title={activeWorkspace === "setup" ? "Startup, recovery, and setup posture" : "Operator console foundation"}
        workspaces={workspaces}
        contextSections={frameContextSections}
        onWorkspaceChange={(workspaceId) => {
          void environment.store.setWorkspace(workspaceId as ShellState["activeWorkspace"]);
        }}
      >
        <div className={styles.workspaceStack}>
          {degradedSummary ? (
            <div className={styles.statusBanner} role="status">
              <div>
                <div className={styles.statusBannerTitle}>Hardware attention required</div>
                <div className={styles.statusBannerBody}>{degradedSummary}</div>
              </div>
              <div className={styles.statusBannerActions}>
                <Button variant="secondary" onClick={requestRestart}>
                  Retry bridges
                </Button>
                <Button variant="ghost" onClick={showShortcuts}>
                  Shortcuts
                </Button>
              </div>
            </div>
          ) : null}
          {body}
        </div>
      </AppShellFrame>
      {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
      {confirmIntent === "restart-engine" ? (
        <ShellDialog
          body="Restarting the engine bridge closes the current shell session, re-runs protocol negotiation, and reloads commissioning/support state."
          confirmLabel="Restart bridge"
          onCancel={() => setConfirmIntent(null)}
          onConfirm={() => void performRestart()}
          title="Restart engine bridge?"
        />
      ) : null}
    </>
  );
}
