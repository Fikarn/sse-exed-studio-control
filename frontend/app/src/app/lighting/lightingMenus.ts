import type { MenuContent, MenuEntry } from "@sse/design-system";

import { deleteArmId } from "./editor/useLightingArming";
import { lightingColorTagName } from "./lightingColorTags";

// The visual overhaul's Lighting page (2026-10-04, DESIGN.md §9): one builder
// per object, shared by the object's ⋯, its right-click and the plate title's
// ⋯, so the three always open the same menu. Each host passes the page's arm
// (`menu={{ ...menu, arm }}`) and owns the dialogs an item opens. The
// "Delete …" items are the menu's destructive item: they arm in place, and the
// second press deletes (every delete here can be undone, or is a group, which
// leaves its fixtures in the rig).

export type LightingMenu = Omit<MenuContent, "arm">;

function colourValue(colorIndex: number | null | undefined) {
  return lightingColorTagName(colorIndex)?.toLowerCase() ?? "none";
}

export interface SceneMenuOptions {
  scene: { id: string; name: string; pinned?: boolean; colorIndex?: number | null };
  /** The menu head's sub-line (`3 on · 3500 K`). */
  detail: string;
  /** Its word on the rig (`on rig`, `unsaved`, `preview`), when it has one. */
  word?: string | null;
  previewMode: boolean;
  /** Why the scene's commands are refused (Patch mode), or null. */
  lockedReason?: string | null;
  /** Why "Save … into it" is refused (the rig holds it, recall it first), or null. */
  saveIntoReason?: string | null;
  onRecall: () => void;
  onSaveInto: () => void;
  onRename: () => void;
  onPin: (pinned: boolean) => void;
  onColour: () => void;
  onDelete: () => void;
  testIdPrefix: string;
}

export function buildSceneMenu(options: SceneMenuOptions): LightingMenu {
  const { scene, detail, word, previewMode, lockedReason = null, saveIntoReason = null, testIdPrefix } = options;
  const items: MenuEntry[] = [
    {
      id: "recall",
      label: previewMode ? "Load into preview" : "Recall",
      value: word ?? undefined,
      onSelect: options.onRecall,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-recall`,
    },
    {
      id: "save-into",
      label: previewMode ? "Save the preview into it" : "Save the rig into it",
      onSelect: options.onSaveInto,
      disabledReason: lockedReason ?? saveIntoReason,
      testId: `${testIdPrefix}-save-into`,
    },
    { kind: "divider", id: "organise" },
    {
      id: "rename",
      label: "Rename…",
      onSelect: options.onRename,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-rename`,
    },
    {
      kind: "check",
      id: "pin",
      label: "Pinned",
      checked: scene.pinned === true,
      onCheckedChange: (pinned) => options.onPin(pinned),
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-pin`,
    },
    {
      id: "colour",
      label: "Colour…",
      value: colourValue(scene.colorIndex),
      onSelect: options.onColour,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-colour`,
    },
  ];
  return {
    head: { title: scene.name, detail },
    items,
    destructive: {
      id: deleteArmId.scene(scene.id),
      label: "Delete scene…",
      armedLabel: `Press again to delete ${scene.name}`,
      onConfirm: options.onDelete,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-delete`,
    },
  };
}

export interface GroupMenuOptions {
  group: { id: string; name: string; on: boolean; colorIndex?: number | null };
  detail: string;
  lockedReason?: string | null;
  onTogglePower: () => void;
  onInspect: () => void;
  onRename: () => void;
  onColour: () => void;
  onDelete: () => void;
  testIdPrefix: string;
}

export function buildGroupMenu(options: GroupMenuOptions): LightingMenu {
  const { group, detail, lockedReason = null, testIdPrefix } = options;
  return {
    head: { title: group.name, detail },
    items: [
      {
        id: "power",
        label: group.on ? "Turn off" : "Turn on",
        onSelect: options.onTogglePower,
        testId: `${testIdPrefix}-power`,
      },
      { id: "inspect", label: "Show on the plate", onSelect: options.onInspect, testId: `${testIdPrefix}-inspect` },
      { kind: "divider", id: "organise" },
      {
        id: "rename",
        label: "Rename…",
        onSelect: options.onRename,
        disabledReason: lockedReason,
        testId: `${testIdPrefix}-rename`,
      },
      {
        id: "colour",
        label: "Colour…",
        value: colourValue(group.colorIndex),
        onSelect: options.onColour,
        disabledReason: lockedReason,
        testId: `${testIdPrefix}-colour`,
      },
    ],
    destructive: {
      id: deleteArmId.group(group.id),
      label: "Delete group…",
      armedLabel: `Press again to delete ${group.name}`,
      onConfirm: options.onDelete,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-delete`,
    },
  };
}

export interface FixtureMenuOptions {
  fixture: { id: string; name: string; on: boolean; groupId?: string | null; spatialRotation?: number | null };
  detail: string;
  groups: ReadonlyArray<{ id: string; name: string }>;
  /** Why the rig's commands are refused (preview stages them, Patch), or null. */
  identifyReason?: string | null;
  editReason?: string | null;
  onTogglePower: () => void;
  onIdentify: () => void;
  onAssignGroup: (groupId: string | null) => void;
  onCreateGroup: () => void;
  onEditPlacement: () => void;
  onResetRotation: () => void;
  onRename: () => void;
  onDelete: () => void;
  testIdPrefix: string;
}

export function buildFixtureMenu(options: FixtureMenuOptions): LightingMenu {
  const { fixture, detail, groups, identifyReason = null, editReason = null, testIdPrefix } = options;
  const rotation = Math.round(fixture.spatialRotation ?? 0);
  const items: MenuEntry[] = [
    {
      id: "power",
      label: fixture.on ? "Turn off" : "Turn on",
      onSelect: options.onTogglePower,
      testId: `${testIdPrefix}-power`,
    },
    {
      id: "identify",
      label: "Identify",
      onSelect: options.onIdentify,
      disabledReason: identifyReason,
      testId: `${testIdPrefix}-identify`,
    },
    { kind: "label", id: "group-label", label: "Group" },
    {
      kind: "radio",
      id: "group-none",
      label: "No group",
      checked: !fixture.groupId,
      onSelect: () => options.onAssignGroup(null),
      disabledReason: editReason,
      testId: `${testIdPrefix}-group-none`,
    },
    ...groups.map((group): MenuEntry => ({
      kind: "radio",
      id: `group-${group.id}`,
      label: group.name,
      checked: fixture.groupId === group.id,
      onSelect: () => options.onAssignGroup(group.id),
      disabledReason: editReason,
      testId: `${testIdPrefix}-group-${group.id}`,
    })),
    {
      id: "new-group",
      label: "New group…",
      onSelect: options.onCreateGroup,
      disabledReason: editReason,
      testId: `${testIdPrefix}-new-group`,
    },
    { kind: "divider", id: "place" },
    {
      id: "placement",
      label: "Edit placement…",
      onSelect: options.onEditPlacement,
      disabledReason: editReason,
      testId: `${testIdPrefix}-placement`,
    },
    {
      id: "reset-rotation",
      label: "Reset rotation",
      value: `${rotation}°`,
      onSelect: options.onResetRotation,
      disabledReason: editReason ?? (rotation === 0 ? "already 0°" : null),
      testId: `${testIdPrefix}-reset-rotation`,
    },
    {
      id: "rename",
      label: "Rename…",
      onSelect: options.onRename,
      testId: `${testIdPrefix}-rename`,
    },
  ];
  return {
    head: { title: fixture.name, detail },
    items,
    destructive: {
      id: deleteArmId.fixture(fixture.id),
      label: "Delete fixture…",
      armedLabel: `Press again to delete ${fixture.name}`,
      onConfirm: options.onDelete,
      disabledReason: editReason,
      testId: `${testIdPrefix}-delete`,
    },
  };
}

export interface PaletteMenuOptions {
  palette: { id: string; name: string; colorIndex?: number | null };
  detail: string;
  first: boolean;
  last: boolean;
  lockedReason?: string | null;
  onEdit: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onColour: () => void;
  onDelete: () => void;
  testIdPrefix: string;
}

export function buildPaletteMenu(options: PaletteMenuOptions): LightingMenu {
  const { palette, detail, first, last, lockedReason = null, testIdPrefix } = options;
  return {
    head: { title: palette.name, detail },
    items: [
      {
        id: "edit",
        label: "Edit…",
        onSelect: options.onEdit,
        disabledReason: lockedReason,
        testId: `${testIdPrefix}-edit`,
      },
      {
        id: "earlier",
        label: "Move earlier",
        onSelect: options.onMoveEarlier,
        disabledReason: lockedReason ?? (first ? "it is first" : null),
        testId: `${testIdPrefix}-earlier`,
      },
      {
        id: "later",
        label: "Move later",
        onSelect: options.onMoveLater,
        disabledReason: lockedReason ?? (last ? "it is last" : null),
        testId: `${testIdPrefix}-later`,
      },
      {
        id: "colour",
        label: "Colour…",
        value: colourValue(palette.colorIndex),
        onSelect: options.onColour,
        disabledReason: lockedReason,
        testId: `${testIdPrefix}-colour`,
      },
    ],
    destructive: {
      id: deleteArmId.palette(palette.id),
      label: "Delete palette…",
      armedLabel: `Press again to delete ${palette.name}`,
      onConfirm: options.onDelete,
      disabledReason: lockedReason,
      testId: `${testIdPrefix}-delete`,
    },
  };
}
