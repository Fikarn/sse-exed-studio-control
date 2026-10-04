import { DMXMonitorDialog } from "../components/DMXMonitorDialog";
import { ConfirmDialog, Dialog, Button } from "@sse/design-system";
import { CreateFixtureDialog } from "../components/CreateFixtureDialog";
import { nextLightingFixtureName } from "../lightingHelpers";
import { RenameDialog } from "../../shared/RenameDialog";
import type { LightingEditor } from "../useLightingEditor";

/** Every dialog the workspace raises. Each opens from a flag in the session.
 *  Since the visual overhaul (2026-10-04) CUT ALL and the deletes arm in place,
 *  and a new scene is saved by the Save row alone, so none of them is here. */
export function LightingDialogs({ editor }: { editor: LightingEditor }) {
  const { lightingDmxMonitorSnapshot, lightingFixtureCatalogSnapshot } = editor.props;
  const {
    dmxMonitorOpen,
    setDmxMonitorOpen,
    busyActions,
    createFixtureOpen,
    setCreateFixtureOpen,
    createGroupOpen,
    setCreateGroupOpen,
  } = editor.session;
  const { bridgeUniverse, bridgeReachable, previewMode, fixtures } = editor.rig;
  const {
    showLeavePrompt,
    stateScene: activeScene,
    setShowLeavePrompt,
    pendingLeaveResolveRef,
    showPreviewExitPrompt,
    setShowPreviewExitPrompt,
    handleDiscardPreview,
    handleResaveScene,
  } = editor.sceneEditor;
  const { handleCreateGroup } = editor.rigControls;
  const { handleAddFixture } = editor.fixtureEditor;
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
                The rig no longer matches <strong>{activeScene.name}</strong>. You can save the changes into it with{" "}
                <strong>Save changes</strong> on the state display, or come back later; the rig stays as it is either
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
    </>
  );
}
