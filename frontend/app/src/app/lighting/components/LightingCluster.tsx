import { useState } from "react";
import type { LightingSceneSnapshot } from "@sse/engine-client";
import { Key, NumberEntryDialog, Readout, Section, Slider, StateDisplay } from "@sse/design-system";

import styles from "./LightingCluster.module.css";
import { GroupRail, type GroupRailEntry } from "./GroupRail";
import { SceneRail } from "./SceneRail";
import { LightingSearchField, type LightingRecentScene } from "./LightingSearchField";
import { deriveLightingState, type LightingState } from "../lightingState";

// Visual overhaul A, Slice 5 (system §2, §7, plan Slice 5): Lighting's cluster.
// The rig's state first and fixed — is the bridge answering, is the rig what
// the scene says, are you editing offline — then the two keys a take reaches
// for (Lighting on, Cut all), the grand master, the scenes, the groups, and the
// standing actions at the foot. Nothing here is a banner: a state is a state
// display, and it is in the same place every time.

export interface LightingClusterProps {
  bridgeIp: string;
  bridgeReachable: boolean;
  bridgeUniverse: number;
  channelCount: number;
  fixtureOnCount: number;
  fixtureTotal: number;
  grandMaster: number;
  groups: readonly GroupRailEntry[];
  lastRecalledLabel: string | null;
  previewBusy?: boolean;
  previewDirty: boolean;
  previewMode: boolean;
  patchMode: boolean;
  recallFadeMs: number;
  sceneModified: boolean;
  sceneName: string | null;
  scenes: readonly LightingSceneSnapshot[];
  sceneRailProps: Omit<Parameters<typeof SceneRail>[0], "scenes" | "bridgeReachable">;
  groupRailProps: Omit<Parameters<typeof GroupRail>[0], "groups">;
  onAddFixture: () => void;
  onDiscardPreview: () => void;
  onEmergencyCut: () => void;
  onGrandMasterChange: (value: number) => void;
  hasSelection: boolean;
  highlightActive: boolean;
  soloActive: boolean;
  recentScenes: readonly LightingRecentScene[];
  searchQuery: string;
  onRecallRecentScene?: (sceneId: string) => void;
  onSearchChange: (value: string) => void;
  onIdentifyFind: () => void;
  onToggleHighlight: () => void;
  onToggleSolo: () => void;
  onOpenDmxMonitor: () => void;
  /** Narrow surfaces open the plate as a drawer; wider ones show it beside the plot. */
  onOpenInspector?: () => void;
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

export function LightingCluster(props: LightingClusterProps) {
  const {
    bridgeIp,
    bridgeReachable,
    bridgeUniverse,
    channelCount,
    fixtureOnCount,
    fixtureTotal,
    grandMaster,
    groups,
    lastRecalledLabel,
    previewBusy = false,
    previewDirty,
    previewMode,
    patchMode,
    recallFadeMs,
    sceneModified,
    sceneName,
    scenes,
    sceneRailProps,
    groupRailProps,
    onAddFixture,
    onDiscardPreview,
    onEmergencyCut,
    onGrandMasterChange,
    hasSelection,
    highlightActive,
    soloActive,
    recentScenes,
    searchQuery,
    onRecallRecentScene,
    onSearchChange,
    onIdentifyFind,
    onToggleHighlight,
    onToggleSolo,
    onOpenDmxMonitor,
    onOpenInspector,
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

  const state: LightingState = deriveLightingState({
    bridgeIp,
    bridgeReachable,
    channelCount,
    fixtureOnCount,
    fixtureTotal,
    lastRecalledLabel,
    previewDirty,
    previewMode,
    sceneModified,
    sceneName,
    universe: bridgeUniverse,
  });

  const anyOn = fixtureOnCount > 0;
  const rigLocked = state.locked || patchMode;
  const lockedReason = state.locked
    ? state.sentence
    : patchMode
      ? "Patch mode is on: the rig's levels are paused while you address fixtures. Press P to leave it."
      : undefined;

  // The way out of the state the rig is in, as keys on the display itself.
  const stateActions = (
    <>
      {/* The bridge probe lives in Setup / Support, so the way out of an
          unreachable bridge is the key that takes the operator there. */}
      {state.word === "UNREACHABLE" ? (
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
            Save to the rig
          </Key>
          <Key size="small" disabled={previewBusy} testId="lighting-state-preview-discard" onClick={onDiscardPreview}>
            Discard
          </Key>
        </>
      ) : null}
    </>
  );

  return (
    <div className={styles.cluster} data-lighting-cluster="" data-testid="lighting-cluster">
      <StateDisplay
        tone={state.tone}
        word={state.word}
        sentence={state.sentence}
        meta={state.meta}
        actions={stateActions}
        data-toolbar-primary="title"
        testId="lighting-state-display"
      />

      <div className={styles.keyRow}>
        <Key
          mode="toggle"
          cap="Lighting"
          hint={anyOn ? `on · ${fixtureOnCount} of ${fixtureTotal} lit` : "off · nothing lit"}
          layout="stack"
          engaged={anyOn}
          locked={rigLocked}
          reason={lockedReason}
          take
          data-toolbar-primary="status"
          testId="lighting-power-toggle"
          aria-pressed={anyOn}
          onClick={() => onToggleAllPower(!anyOn)}
        />
        <Key
          mode="danger"
          cap="Cut all"
          hint="all to 0 %"
          layout="stack"
          locked={rigLocked}
          reason={lockedReason}
          take
          testId="lighting-emergency-cut"
          aria-label="Cut all fixtures to 0 %"
          onClick={onEmergencyCut}
        />
      </div>

      <section className={styles.master} aria-label="Grand master">
        <div className={styles.masterHead}>
          <span className={styles.masterLabel}>Grand master</span>
          <span className={styles.masterHint}>every fixture</span>
        </div>
        <Readout value={`${Math.round(grandMaster)} %`} size="hero" testId="lighting-grand-master-readout" />
        <Slider
          label="Grand master intensity"
          value={grandMaster / 100}
          valueText={`${Math.round(grandMaster)} %`}
          locked={rigLocked}
          take
          testId="lighting-grand-master"
          onChange={(value) => onGrandMasterChange(Math.round(value * 100))}
          onCommit={(value) => onGrandMasterChange(Math.round(value * 100))}
          onRequestTypedEntry={rigLocked ? undefined : () => setMasterDialogOpen(true)}
        />
      </section>

      {/* One field filters the scenes, the groups and the plot together, with
          the scenes most recently recalled under it. */}
      <LightingSearchField
        recentScenes={recentScenes}
        searchQuery={searchQuery}
        onRecallRecentScene={onRecallRecentScene}
        onSearchChange={onSearchChange}
      />

      <Section
        className={styles.section}
        title="Scenes"
        detail={patchMode ? "paused while patching" : `${scenes.length} saved · press to recall`}
        testId="lighting-scenes-section"
        actions={
          <Key
            size="small"
            testId="lighting-fade-key"
            aria-label="Recall fade time"
            onClick={() => setFadeDialogOpen(true)}
          >
            Fade {fadeLabel(recallFadeMs)}
          </Key>
        }
      >
        <SceneRail {...sceneRailProps} scenes={scenes} bridgeReachable={bridgeReachable} />
        <div className={styles.sectionKeys}>
          <Key
            size="small"
            locked={rigLocked}
            reason={lockedReason}
            take
            testId="lighting-save-scene"
            onClick={onSaveScene}
          >
            Save · press twice
          </Key>
        </div>
      </Section>

      <Section
        className={styles.section}
        title="Groups"
        detail={
          groups.length > 0
            ? `${groups.filter((group) => group.on).length} of ${groups.length} on`
            : "one level for all their fixtures"
        }
        testId="lighting-groups-section"
      >
        <GroupRail {...groupRailProps} groups={groups} />
      </Section>

      <Section className={styles.actions} title="Rig" testId="lighting-standing-actions">
        <div className={styles.actionRow}>
          <Key
            size="small"
            mode="primary"
            data-toolbar-primary="add"
            testId="lighting-add-fixture"
            onClick={onAddFixture}
          >
            Add fixture
          </Key>
          <Key
            size="small"
            mode="toggle"
            engaged={patchMode}
            aria-pressed={patchMode}
            disabled={previewMode}
            title={previewMode ? "Leave preview to address fixtures" : "Address fixtures on the rig"}
            data-toolbar-primary="patch"
            testId="lighting-patch-toggle"
            onClick={onTogglePatch}
          >
            Patch
          </Key>
          <Key
            size="small"
            mode="toggle"
            engaged={previewMode}
            aria-pressed={previewMode}
            data-toolbar-primary="preview"
            testId="lighting-preview-toggle"
            onClick={onTogglePreview}
          >
            Preview
          </Key>
          <Key size="small" testId="lighting-open-dmx-monitor" onClick={onOpenDmxMonitor}>
            DMX monitor
          </Key>
          {onOpenInspector ? (
            <Key size="small" testId="lighting-open-inspector" aria-label="Inspector" onClick={onOpenInspector}>
              Inspector
            </Key>
          ) : null}
        </div>
        {/* What the selection can be asked to do: hold it lit, dim everything
            else, or pulse it so the operator can find it in the room. */}
        <div className={styles.actionRow}>
          <Key
            size="small"
            mode="toggle"
            engaged={highlightActive}
            aria-pressed={highlightActive}
            disabled={previewMode || (!hasSelection && !highlightActive)}
            title={
              hasSelection ? "Hold the selection at full white at neutral CCT" : "Select fixtures to enable Highlight"
            }
            testId="lighting-highlight-toggle"
            onClick={onToggleHighlight}
          >
            Highlight
          </Key>
          <Key
            size="small"
            mode="toggle"
            engaged={soloActive}
            aria-pressed={soloActive}
            disabled={previewMode || (!hasSelection && !soloActive)}
            title={hasSelection ? "Dim every fixture except the selection" : "Select fixtures to enable Solo"}
            testId="lighting-solo-toggle"
            onClick={onToggleSolo}
          >
            Solo
          </Key>
          <Key
            size="small"
            disabled={previewMode || !hasSelection}
            title={
              hasSelection
                ? "Pulse the selection in turn so you can locate each fixture"
                : "Select fixtures to enable Find"
            }
            testId="lighting-identify-find"
            onClick={onIdentifyFind}
          >
            Find
          </Key>
        </div>
      </Section>

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
