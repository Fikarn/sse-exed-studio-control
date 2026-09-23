import { DMXMonitorDialog } from "../components/DMXMonitorDialog";
import { ConfirmDialog, Dialog, Button } from "@sse/design-system";
import { CreateFixtureDialog } from "../components/CreateFixtureDialog";
import { nextLightingFixtureName } from "../lightingHelpers";
import { RenameDialog } from "../components/RenameDialog";
import type { LightingEditor } from "../useLightingEditor";

/** Every dialog the workspace raises. Each opens from a flag in the session. */
export function LightingDialogs({ editor }: { editor: LightingEditor }) {
  const { lightingDmxMonitorSnapshot, lightingFixtureCatalogSnapshot } = editor.props;
  const {
    dmxMonitorOpen,
    setDmxMonitorOpen,
    busyActions,
    confirmCutAllOpen,
    setConfirmCutAllOpen,
    confirmDeleteScene,
    setConfirmDeleteScene,
    confirmDeleteGroup,
    setConfirmDeleteGroup,
    confirmDeleteFixture,
    setConfirmDeleteFixture,
    createFixtureOpen,
    setCreateFixtureOpen,
    createGroupOpen,
    setCreateGroupOpen,
    saveSceneAsOpen,
    setSaveSceneAsOpen,
  } = editor.session;
  const { bridgeUniverse, bridgeReachable, previewMode, fixtures, scenes } = editor.rig;
  const {
    showLeavePrompt,
    activeScene,
    setShowLeavePrompt,
    pendingLeaveResolveRef,
    showPreviewExitPrompt,
    setShowPreviewExitPrompt,
    handleDiscardPreview,
    handleResaveScene,
    handleDeleteScene,
    handleSaveScene,
  } = editor.sceneEditor;
  const { handleEmergencyCut, handleDeleteGroup, handleCreateGroup } = editor.rigControls;
  const { handleDeleteFixture, handleAddFixture } = editor.fixtureEditor;
  return (
    <>
      {dmxMonitorOpen ? (
        <DMXMonitorDialog
          universe={bridgeUniverse}
          snapshot={lightingDmxMonitorSnapshot}
          reachable={bridgeReachable}
          onClose={() => setDmxMonitorOpen(false)}
        />
      ) : null}

      {showLeavePrompt ? (
        <ConfirmDialog
          title="Leave with unsaved changes?"
          body={
            previewMode && activeScene ? (
              <>
                Preview scene <strong>{activeScene.name}</strong> has offline edits. Save or discard the preview before
                switching workspaces; the live rig is unchanged.
              </>
            ) : activeScene ? (
              <>
                Scene <strong>{activeScene.name}</strong> has live changes that aren't saved. You can save them with{" "}
                <strong>Save changes</strong> in the rail, or come back later — the live rig state stays as it is either
                way.
              </>
            ) : (
              <>The active scene has unsaved changes that won't be discarded — the live rig state stays as it is.</>
            )
          }
          confirmLabel="Leave anyway"
          cancelLabel="Stay"
          danger
          onConfirm={() => {
            setShowLeavePrompt(false);
            pendingLeaveResolveRef.current?.(true);
            pendingLeaveResolveRef.current = null;
          }}
          onCancel={() => {
            setShowLeavePrompt(false);
            pendingLeaveResolveRef.current?.(false);
            pendingLeaveResolveRef.current = null;
          }}
        />
      ) : null}

      {showPreviewExitPrompt ? (
        <Dialog
          title="Exit preview with offline edits?"
          body={
            activeScene ? (
              <>
                Preview scene <strong>{activeScene.name}</strong> has edits that are not saved. Save writes the preview
                into the scene and leaves the live rig unchanged.
              </>
            ) : (
              <>The preview has edits that are not saved. Save as new or discard before exiting preview.</>
            )
          }
          onClose={() => setShowPreviewExitPrompt(false)}
          actions={
            <>
              <Button
                size="compact"
                variant="ghost"
                disabled={busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => setShowPreviewExitPrompt(false)}
              >
                Cancel
              </Button>
              <Button
                size="compact"
                variant="secondary"
                disabled={busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => void handleDiscardPreview()}
              >
                Discard
              </Button>
              <Button
                size="compact"
                variant="primary"
                disabled={!activeScene || busyActions.has("preview-discard") || busyActions.has("scene-resave")}
                onClick={() => {
                  setShowPreviewExitPrompt(false);
                  void handleResaveScene();
                }}
              >
                Save
              </Button>
            </>
          }
        />
      ) : null}

      {confirmCutAllOpen ? (
        <ConfirmDialog
          title={previewMode ? "Cut all fixtures in the preview?" : "Cut all fixtures?"}
          body={
            previewMode ? (
              <>
                This cuts the <strong>preview</strong> only — every previewed fixture goes to off. The live rig is
                untouched until you apply the preview.
              </>
            ) : (
              <>
                This sends every fixture to <strong>off</strong> immediately. Saved scenes are unaffected — recall any
                scene to restore the rig.
              </>
            )
          }
          confirmLabel={previewMode ? "Cut preview" : "Cut all"}
          cancelLabel="Cancel"
          danger
          busy={busyActions.has("lighting-blackout")}
          onConfirm={() => {
            setConfirmCutAllOpen(false);
            void handleEmergencyCut();
          }}
          onCancel={() => setConfirmCutAllOpen(false)}
        />
      ) : null}

      {confirmDeleteScene ? (
        <ConfirmDialog
          title="Delete scene?"
          body={
            <>
              This removes <strong>{confirmDeleteScene.name}</strong>. Other scenes are unaffected, the live rig state
              stays as it is, and you can undo it from the message that confirms the deletion.
            </>
          }
          confirmLabel="Delete scene"
          danger
          busy={busyActions.has("scene-delete")}
          onConfirm={() => {
            const target = confirmDeleteScene;
            setConfirmDeleteScene(null);
            void handleDeleteScene(target.id);
          }}
          onCancel={() => setConfirmDeleteScene(null)}
        />
      ) : null}

      {confirmDeleteGroup ? (
        <ConfirmDialog
          title="Delete group?"
          body={
            <>
              This removes <strong>{confirmDeleteGroup.name}</strong>. Member fixtures stay in the rig — only the group
              is deleted.
            </>
          }
          confirmLabel="Delete group"
          danger
          busy={busyActions.has(`group-delete:${confirmDeleteGroup.id}`)}
          onConfirm={() => {
            const target = confirmDeleteGroup;
            setConfirmDeleteGroup(null);
            void handleDeleteGroup(target.id, target.name);
          }}
          onCancel={() => setConfirmDeleteGroup(null)}
        />
      ) : null}

      {confirmDeleteFixture ? (
        <ConfirmDialog
          title="Delete fixture?"
          body={
            <>
              This permanently removes <strong>{confirmDeleteFixture.name}</strong> from the rig. Saved scenes that
              referenced it lose this fixture's saved state.
            </>
          }
          confirmLabel="Delete fixture"
          danger
          busy={busyActions.has(`fixture-delete:${confirmDeleteFixture.id}`)}
          onConfirm={() => {
            const target = confirmDeleteFixture;
            setConfirmDeleteFixture(null);
            void handleDeleteFixture(target.id);
          }}
          onCancel={() => setConfirmDeleteFixture(null)}
        />
      ) : null}

      {createFixtureOpen ? (
        <CreateFixtureDialog
          catalog={lightingFixtureCatalogSnapshot}
          fixtures={fixtures}
          defaultName={nextLightingFixtureName(fixtures)}
          busy={busyActions.has("fixture-create")}
          onConfirm={(spec) => {
            setCreateFixtureOpen(false);
            void handleAddFixture(spec);
          }}
          onCancel={() => setCreateFixtureOpen(false)}
        />
      ) : null}

      {createGroupOpen ? (
        <RenameDialog
          title="New lighting group"
          fieldLabel="Group name"
          initialValue=""
          placeholder="e.g. Key, Fill, Back"
          confirmLabel="Create group"
          busy={busyActions.has("group-create")}
          onConfirm={(name) => {
            setCreateGroupOpen(false);
            void handleCreateGroup(name);
          }}
          onCancel={() => setCreateGroupOpen(false)}
        />
      ) : null}

      {saveSceneAsOpen ? (
        <RenameDialog
          title={previewMode ? "Save preview as new scene" : "Save as new scene"}
          fieldLabel="Scene name"
          initialValue={`Scene ${scenes.length + 1}`}
          placeholder="e.g. Talking head, Wide, Backlit"
          confirmLabel="Save scene"
          busy={busyActions.has("scene-create")}
          onConfirm={(name) => {
            setSaveSceneAsOpen(false);
            void handleSaveScene(name);
          }}
          onCancel={() => setSaveSceneAsOpen(false)}
        />
      ) : null}
    </>
  );
}
