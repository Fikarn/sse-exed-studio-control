import { useEffect, useRef, useState } from "react";
import {
  ARM_TIMEOUT_MS,
  ArmKey,
  Key,
  Latch,
  LatchSlot,
  Menu,
  MenuButton,
  NumberEntryDialog,
  Section,
  Slider,
  StateDisplay,
  Tooltip,
  type MenuEntry,
  type UseArmResult,
} from "@sse/design-system";

import styles from "./LightingCluster.module.css";
import { GroupRail, type GroupRailProps } from "./GroupRail";
import { SceneRail, type SceneRailProps } from "./SceneRail";
import { LightingSearchField, type LightingRecentScene } from "./LightingSearchField";
import { deriveLightingState, type LightingState } from "../lightingState";
import { CUT_ALL_ARM_KEY, CUT_ALL_WINDOW_MS, SAVE_SCENE_ARM_KEY } from "../editor/useLightingArming";

// The visual overhaul's Lighting page (2026-10-04): the cluster. The rig's
// state first and fixed, with the page's ⋯ (the standing commands: Add
// fixture, Patch, Preview, the DMX monitor and strip, Setup); the latch slot
// under it (Patch, Highlight, Solo, each with the key that ends it); the two
// take-time keys (LIGHTING, CUT ALL, which arms as the deck's ALL OFF does);
// the grand master; the groups as keys; the search; the scenes as rows with
// the Save row under them, filling the room left; Undo at the foot. Nothing
// here scrolls, and nothing above a take-time key ever moves.

export interface LightingClusterProps {
  bridgeIp: string;
  bridgeReachable: boolean;
  /** The bridge watch's word (the snapshot's `bridgeAnswering`); it locks nothing. */
  bridgeAnswering?: boolean | null;
  /** When the bridge went silent, on the studio's clock (`10:42`). */
  bridgeSilentLabel?: string | null;
  bridgeUniverse: number;
  /** The light outputs are held (the lighting snapshot's `outputArmed === false`). */
  outputsHeld?: boolean;
  channelCount: number;
  fixtureOnCount: number;
  fixtureTotal: number;
  grandMaster: number;
  lastSavedLabel: string | null;
  previewBusy?: boolean;
  previewDirty: boolean;
  previewMode: boolean;
  patchMode: boolean;
  recallFadeMs: number;
  sceneModified: boolean;
  sceneName: string | null;
  /** The page's one arm (`useLightingArming`), and what its armed row says. */
  arm: UseArmResult;
  armedWords: string | null;
  sceneRailProps: Omit<SceneRailProps, "footer" | "arm" | "lockedReason">;
  groupRailProps: Omit<GroupRailProps, "arm">;
  /** The Highlight and Solo latched on the rig, with the fixtures they hold. */
  highlightNames: readonly string[];
  soloNames: readonly string[];
  onToggleHighlight: () => void;
  onToggleSolo: () => void;
  onAddFixture: () => void;
  onCreateGroup: () => void;
  onDiscardPreview: () => void;
  onEmergencyCut: () => void;
  onGrandMasterChange: (value: number) => void;
  /** The step the Undo key will undo, or null when there is nothing to undo. */
  undoLabel?: string | null;
  undoBusy?: boolean;
  recentScenes: readonly LightingRecentScene[];
  searchQuery: string;
  onRecallRecentScene?: (sceneId: string) => void;
  onSearchChange: (value: string) => void;
  onUndo?: () => void;
  onOpenDmxMonitor: () => void;
  dmxStripOn: boolean;
  onToggleDmxStrip: () => void;
  onRecallFadeMsChange: (value: number) => void;
  onResaveScene: () => void;
  onRevertScene?: () => void;
  onOpenSetup: () => void;
  onSaveScene: () => void;
  onToggleAllPower: (on: boolean) => void;
  onTogglePatch: () => void;
  onTogglePreview: () => void;
}

function fadeLabel(recallFadeMs: number) {
  return `${(recallFadeMs / 1000).toFixed(1)} s`;
}

const FADE_PRESETS_MS = [0, 500, 1000, 2000, 3000, 5000] as const;

// The Undo key's small print names the step it will undo; a long scene or
// fixture name is cut so the key stays inside the cluster (its full name is
// the key's accessible name and title).
const UNDO_LABEL_MAX_CHARS = 40;

function undoSmallPrint(label: string) {
  return label.length > UNDO_LABEL_MAX_CHARS ? `${label.slice(0, UNDO_LABEL_MAX_CHARS - 1)}…` : label;
}

function names(list: readonly string[]) {
  if (list.length <= 2) return list.join(", ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

export function LightingCluster(props: LightingClusterProps) {
  const {
    bridgeIp,
    bridgeReachable,
    bridgeAnswering = null,
    bridgeSilentLabel = null,
    outputsHeld = false,
    bridgeUniverse,
    channelCount,
    fixtureOnCount,
    fixtureTotal,
    grandMaster,
    lastSavedLabel,
    previewBusy = false,
    previewDirty,
    previewMode,
    patchMode,
    recallFadeMs,
    sceneModified,
    sceneName,
    arm,
    armedWords,
    sceneRailProps,
    groupRailProps,
    highlightNames,
    soloNames,
    onToggleHighlight,
    onToggleSolo,
    onAddFixture,
    onCreateGroup,
    onDiscardPreview,
    onEmergencyCut,
    onGrandMasterChange,
    undoLabel = null,
    undoBusy = false,
    recentScenes,
    searchQuery,
    onRecallRecentScene,
    onSearchChange,
    onUndo,
    onOpenDmxMonitor,
    dmxStripOn,
    onToggleDmxStrip,
    onRecallFadeMsChange,
    onResaveScene,
    onRevertScene,
    onOpenSetup,
    onSaveScene,
    onToggleAllPower,
    onTogglePatch,
    onTogglePreview,
  } = props;

  const [masterDialogOpen, setMasterDialogOpen] = useState(false);
  const [fadeDialogOpen, setFadeDialogOpen] = useState(false);
  const [fadeMenuOpen, setFadeMenuOpen] = useState(false);
  const fadeKeyRef = useRef<HTMLSpanElement | null>(null);
  const saveArmed = arm.armed?.key === SAVE_SCENE_ARM_KEY;
  const cutArmed = arm.armed?.key === CUT_ALL_ARM_KEY;

  const state: LightingState = deriveLightingState({
    bridgeIp,
    bridgeReachable,
    bridgeAnswering,
    bridgeSilentLabel,
    channelCount,
    fixtureOnCount,
    fixtureTotal,
    lastSavedLabel,
    outputsHeld,
    previewDirty,
    previewMode,
    sceneModified,
    sceneName,
    universe: bridgeUniverse,
  });

  const anyOn = fixtureOnCount > 0;
  const rigLocked = state.locked || patchMode;
  // A key that locks takes its arm with it; CUT ALL keeps its own, since it
  // never locks while there is a rig to cut.
  const clearArm = arm.clear;
  const armedKey = arm.armed?.key ?? null;
  useEffect(() => {
    if (rigLocked && armedKey === SAVE_SCENE_ARM_KEY) clearArm();
  }, [armedKey, clearArm, rigLocked]);
  const lockedReason = state.locked
    ? state.sentence
    : patchMode
      ? "Patch mode is on: leave it to switch the rig and save scenes."
      : undefined;
  // The grand master acts on the rig itself, never on the preview (the
  // hardware link does not stage it), so in Preview it waits: until 2026-10-04
  // it moved the live rig while the display said the rig was unchanged.
  const masterLocked = rigLocked || previewMode;
  const masterReason = previewMode
    ? "The grand master acts on the rig itself, not on the preview. Leave Preview to set it."
    : lockedReason;
  // CUT ALL is never locked by the page: the hardware link takes it in every
  // state the rig is in. Only a rig with no fixtures has nothing to cut.
  const cutLockedReason = fixtureTotal === 0 ? "There are no fixtures on the rig to cut." : undefined;
  // The visual overhaul's polish (2026-10-05): LIGHTING locks beside CUT ALL
  // on an empty rig, with its reason; until then it stayed live with nothing
  // to switch.
  const powerLockedReason =
    lockedReason ?? (fixtureTotal === 0 ? "There are no fixtures on the rig to switch." : undefined);
  // While the bridge has not passed its probe the scene rows stay pressable
  // (a press shows the scene on the plate), and the Scenes head says that a
  // recall waits. UNREACHABLE outranks PREVIEW, and a recall into the preview
  // is allowed, so not in Preview.
  const recallsRefused = state.word === "UNREACHABLE" && !previewMode;

  // The way out of the state the rig is in, as keys on the display itself.
  const stateActions = (
    <>
      {/* The bridge probe lives in Setup / Support, so the way out of an
          unreachable bridge is the key that takes the operator there, as it is
          the way to the Light outputs switch. Held as well, the key is the way
          to arm. */}
      {state.word === "UNREACHABLE" || state.word === "HELD" || (state.word === "NOT ANSWERING" && outputsHeld) ? (
        <Key size="small" testId="lighting-state-setup" onClick={onOpenSetup}>
          Open Setup
        </Key>
      ) : null}
      {state.word === "UNSAVED" ? (
        <>
          <Key size="small" mode="primary" testId="lighting-state-save" onClick={onResaveScene}>
            Save changes
          </Key>
          {onRevertScene ? (
            <Key size="small" testId="lighting-state-revert" onClick={onRevertScene}>
              Recall it again
            </Key>
          ) : null}
        </>
      ) : null}
      {state.word === "PREVIEW" ? (
        <>
          <Key
            size="small"
            mode="primary"
            disabled={previewBusy || !sceneName}
            testId="lighting-state-preview-save"
            onClick={onResaveScene}
          >
            {/* It saves the preview into the scene; the rig takes it when the
                scene is recalled. */}
            Save into the scene
          </Key>
          <Key size="small" disabled={previewBusy} testId="lighting-state-preview-discard" onClick={onDiscardPreview}>
            Discard
          </Key>
        </>
      ) : null}
    </>
  );

  // The page's ⋯: the standing commands, keeping the test ids the standing
  // keys had (the Console's pattern). Each refusal says why at the right.
  const pageMenu: MenuEntry[] = [
    {
      id: "add-fixture",
      label: "Add fixture…",
      onSelect: onAddFixture,
      disabledReason: previewMode ? "leave preview to add fixtures" : null,
      testId: "lighting-add-fixture",
    },
    {
      kind: "check",
      id: "patch",
      label: "Patch",
      checked: patchMode,
      onCheckedChange: () => onTogglePatch(),
      disabledReason: previewMode ? "leave preview to address fixtures" : null,
      testId: "lighting-patch-toggle",
    },
    {
      kind: "check",
      id: "preview",
      label: "Preview",
      checked: previewMode,
      onCheckedChange: () => onTogglePreview(),
      disabledReason: patchMode ? "leave Patch to edit offline" : null,
      testId: "lighting-preview-toggle",
    },
    { kind: "divider", id: "dmx" },
    { id: "dmx-monitor", label: "DMX monitor…", onSelect: onOpenDmxMonitor, testId: "lighting-open-dmx-monitor" },
    {
      kind: "check",
      id: "dmx-strip",
      label: "DMX strip",
      checked: dmxStripOn,
      onCheckedChange: () => onToggleDmxStrip(),
      onWord: "shown",
      offWord: "hidden",
      testId: "lighting-dmx-strip-toggle",
    },
    { kind: "divider", id: "setup-divider" },
    { id: "setup", label: "Open Setup", onSelect: onOpenSetup, testId: "lighting-page-setup" },
  ];

  const fadeMenu: MenuEntry[] = [
    { kind: "label", id: "fade-label", label: "Recall fade" },
    ...FADE_PRESETS_MS.map((ms): MenuEntry => ({
      kind: "radio",
      id: `fade-${ms}`,
      label: fadeLabel(ms),
      checked: recallFadeMs === ms,
      onSelect: () => onRecallFadeMsChange(ms),
      testId: `lighting-fade-${ms}`,
    })),
    { kind: "divider", id: "fade-divider" },
    {
      id: "fade-type",
      label: "Type a value…",
      value: fadeLabel(recallFadeMs),
      onSelect: () => setFadeDialogOpen(true),
      testId: "lighting-fade-type",
    },
  ];

  const saveRow = (
    <ArmKey
      armed={saveArmed}
      timeoutMs={ARM_TIMEOUT_MS}
      countdownTestId="lighting-save-scene-countdown"
      size="large"
      locked={rigLocked}
      reason={lockedReason}
      take
      className={styles.saveRow}
      testId="lighting-save-scene"
      onClick={() => arm.armOrApply(SAVE_SCENE_ARM_KEY, "Save as a new scene", onSaveScene)}
    >
      {saveArmed ? "Save as a new scene" : "＋ Save as a new scene"}
    </ArmKey>
  );

  return (
    <div className={styles.cluster} data-lighting-cluster="" data-testid="lighting-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta}
        armed={
          arm.armed
            ? {
                text: `${armedWords ?? arm.armed.label} · press again`,
                timeoutMs: arm.armed.timeoutMs,
                armedAt: arm.armed.armedAt,
              }
            : null
        }
        actions={stateActions}
        data-toolbar-primary="title"
        testId="lighting-state-display"
        menu={
          <MenuButton
            buttonLabel="Lighting menu"
            buttonTestId="lighting-page-menu"
            menu={{ head: { title: "Lighting" }, items: pageMenu, arm }}
          />
        }
      />

      {/* The latch slot, the same on every page: what holds the rig in a
          state the operator must see, with the key that ends it. */}
      <LatchSlot testId="lighting-latch-slot">
        {patchMode ? (
          <Latch
            who="Patch"
            tone="info"
            testId="lighting-latch-patch"
            action={
              <Key size="small" testId="lighting-latch-patch-leave" onClick={onTogglePatch}>
                Leave
              </Key>
            }
          >
            addressing fixtures
          </Latch>
        ) : null}
        {highlightNames.length > 0 ? (
          <Latch
            who="Highlight"
            testId="lighting-latch-highlight"
            action={
              <Key size="small" testId="lighting-latch-highlight-off" onClick={onToggleHighlight}>
                Off
              </Key>
            }
          >
            {names(highlightNames)}
          </Latch>
        ) : null}
        {soloNames.length > 0 ? (
          <Latch
            who="Solo"
            testId="lighting-latch-solo"
            action={
              <Key size="small" testId="lighting-latch-solo-off" onClick={onToggleSolo}>
                Off
              </Key>
            }
          >
            {names(soloNames)}
          </Latch>
        ) : null}
      </LatchSlot>

      <div className={styles.keyRow}>
        <Key
          mode="toggle"
          cap="Lighting"
          hint={anyOn ? `on · ${fixtureOnCount} of ${fixtureTotal} lit` : "off · nothing lit"}
          layout="stack"
          size="tall"
          live={anyOn}
          locked={Boolean(powerLockedReason)}
          reason={powerLockedReason}
          take
          data-toolbar-primary="status"
          testId="lighting-power-toggle"
          aria-pressed={anyOn}
          onClick={() => onToggleAllPower(!anyOn)}
        />
        <ArmKey
          armed={cutArmed}
          timeoutMs={CUT_ALL_WINDOW_MS}
          countdownTestId="lighting-cut-all-countdown"
          cap={cutArmed ? undefined : "Cut all"}
          hint="all to 0 %"
          layout="stack"
          size="tall"
          locked={Boolean(cutLockedReason)}
          reason={cutLockedReason}
          take
          className={styles.cutAll}
          testId="lighting-emergency-cut"
          aria-label="Cut all fixtures to 0 %"
          onClick={() =>
            arm.armOrApply(
              CUT_ALL_ARM_KEY,
              previewMode ? "Cut all in the preview" : "Cut all fixtures",
              onEmergencyCut,
              CUT_ALL_WINDOW_MS
            )
          }
        >
          {cutArmed ? "Cut all" : undefined}
        </ArmKey>
      </div>

      <Section
        className={styles.section}
        title={
          <Tooltip content="Scales every fixture's level on the rig.">
            <span>Grand master</span>
          </Tooltip>
        }
        actions={
          <span className={styles.masterValue} data-testid="lighting-grand-master-readout">
            {Math.round(grandMaster)} <span className={styles.unit}>%</span>
          </span>
        }
        aria-label="Grand master"
      >
        {/* A locked slider says why on hover, as a locked key does. */}
        <div title={masterLocked ? masterReason : undefined}>
          <Slider
            label="Grand master intensity"
            value={grandMaster / 100}
            valueText={`${Math.round(grandMaster)} %`}
            locked={masterLocked}
            take
            testId="lighting-grand-master"
            onChange={(value) => onGrandMasterChange(Math.round(value * 100))}
            onCommit={(value) => onGrandMasterChange(Math.round(value * 100))}
            onRequestTypedEntry={masterLocked ? undefined : () => setMasterDialogOpen(true)}
          />
        </div>
      </Section>

      <Section
        className={styles.section}
        title="Groups"
        detail={
          groupRailProps.groups.length > 0
            ? `${groupRailProps.groups.filter((group) => group.on).length} of ${groupRailProps.groups.length} on`
            : undefined
        }
        testId="lighting-groups-section"
        actions={
          <Key
            size="small"
            aria-label="Create a new lighting group"
            disabled={patchMode}
            title={patchMode ? "Leave Patch to make a group." : undefined}
            onClick={onCreateGroup}
          >
            ＋
          </Key>
        }
      >
        <GroupRail {...groupRailProps} arm={arm} />
      </Section>

      {/* One field filters the scenes, the groups and the plot together, with
          the scenes most recently recalled under it. */}
      <LightingSearchField
        recentScenes={recentScenes}
        searchQuery={searchQuery}
        onRecallRecentScene={onRecallRecentScene}
        onSearchChange={onSearchChange}
      />

      <Section
        className={styles.scenes}
        title="Scenes"
        detail={
          patchMode ? "Patch is on" : recallsRefused ? "recalls refused" : `${sceneRailProps.scenes.length} saved`
        }
        testId="lighting-scenes-section"
        actions={
          <span ref={fadeKeyRef} className={styles.fadeAnchor}>
            <Key
              size="small"
              testId="lighting-fade-key"
              aria-haspopup="menu"
              aria-expanded={fadeMenuOpen}
              onClick={() => setFadeMenuOpen((open) => !open)}
            >
              Fade {fadeLabel(recallFadeMs)}
            </Key>
          </span>
        }
      >
        <SceneRail {...sceneRailProps} lockedReason={patchMode ? lockedReason : null} arm={arm} footer={saveRow} />
      </Section>

      {/* The Undo key undoes the newest of the last 25 steps — Save scene,
          Delete scene, Add fixture, Delete fixture — and its small print
          names that step. With nothing to undo it takes the system's locked
          form, dimmed and dashed, with its reason. */}
      {onUndo ? (
        <div className={styles.foot}>
          <Key
            size="small"
            hint={undoLabel ? undoSmallPrint(undoLabel) : "nothing to undo"}
            locked={!undoLabel}
            reason="Nothing to undo. Save scene, Delete scene, Add fixture and Delete fixture can be undone."
            disabled={Boolean(undoLabel) && undoBusy}
            title={undoLabel ? `Undo ${undoLabel}` : undefined}
            aria-label={undoLabel ? `Undo ${undoLabel}` : undefined}
            testId="lighting-undo"
            onClick={onUndo}
          >
            Undo
          </Key>
        </div>
      ) : null}

      <Menu
        open={fadeMenuOpen}
        anchor={fadeKeyRef.current}
        onClose={() => setFadeMenuOpen(false)}
        head={{ title: "Fade", detail: "every recall, here and on the deck" }}
        items={fadeMenu}
        ignoreOutside={[fadeKeyRef]}
        placement="bottom-end"
        testId="lighting-fade-menu"
      />

      {masterDialogOpen ? (
        <NumberEntryDialog
          title="Set Grand master"
          fieldLabel="Grand master"
          initialValue={Math.round(grandMaster)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onConfirm={(value) => {
            onGrandMasterChange(value);
            setMasterDialogOpen(false);
          }}
          onCancel={() => setMasterDialogOpen(false)}
        />
      ) : null}

      {fadeDialogOpen ? (
        <NumberEntryDialog
          title="Set recall fade"
          fieldLabel="Fade"
          initialValue={Number((recallFadeMs / 1000).toFixed(1))}
          min={0}
          max={10}
          step={0.1}
          suffix="s"
          onConfirm={(value) => {
            onRecallFadeMsChange(Math.round(value * 1000));
            setFadeDialogOpen(false);
          }}
          onCancel={() => setFadeDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}
