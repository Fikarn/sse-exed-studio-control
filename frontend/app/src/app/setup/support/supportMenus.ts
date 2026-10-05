import type { MenuContent, MenuEntry } from "@sse/design-system";

import { describeBackupKind, formatBackupTimestamp, type SupportBackupEntry } from "../../shellData";
import { setupMenuArmId } from "../setupArming";

// The visual overhaul's Setup page (2026-10-05, DESIGN.md §9): one builder per
// object, as `camerasMenus.ts`, `lightingMenus.ts` and `teleprompterMenus.ts`
// have. Each host passes the page's arm (`menu={{ ...menu, arm }}`) and owns
// the dialog an item opens.
//
// A restore is never a menu's destructive item: it replaces the saved data,
// and it says what it replaces in its own dialog before anything happens, the
// same dialog as the keys' (the owner's leaning, 2026-10-05). The item ends in
// "…", which means it asks. `Forget CAM n…` is the camera's destructive item:
// it arms in place, and the second press forgets.

export type SetupMenu = Omit<MenuContent, "arm">;

export interface BackupMenuOptions {
  backup: SupportBackupEntry;
  /** Its path is the one in the field. */
  chosen: boolean;
  busy: boolean;
  onChoose: () => void;
  onVerify: () => void;
  /** Opens the restore's dialog, which says what it replaces. */
  onRestore: () => void;
  testIdPrefix: string;
}

export function buildBackupMenu(options: BackupMenuOptions): SetupMenu {
  const { backup, chosen, busy, testIdPrefix } = options;
  const busyReason = busy ? "another action is running" : null;
  return {
    head: {
      title: backup.name,
      detail: `${formatBackupTimestamp(backup.modifiedAt)} · ${describeBackupKind(backup.kind)}`,
    },
    items: [
      {
        id: "choose",
        label: "Put its path in the field",
        value: chosen ? "in the field" : undefined,
        disabledReason: chosen ? "in the field" : null,
        onSelect: options.onChoose,
        testId: `${testIdPrefix}-choose`,
      },
      {
        id: "verify",
        label: "Verify",
        disabledReason: busyReason,
        onSelect: options.onVerify,
        testId: `${testIdPrefix}-verify`,
      },
      { kind: "divider", id: "divider" },
      {
        id: "restore",
        label: "Restore…",
        disabledReason: busyReason,
        onSelect: options.onRestore,
        testId: `${testIdPrefix}-restore`,
      },
    ],
  };
}

export interface SupportPlateMenuOptions {
  busy: boolean;
  /** Why the latest backup cannot be verified or restored; `null` when it can. */
  noBackupReason: string | null;
  canOpenLog: boolean;
  onExportBackup: () => void;
  onVerifyLatest: () => void;
  onRestoreLatest: () => void;
  onExportDiagnostics: () => void;
  onOpenLog: () => void;
  onStudioFullscreen: () => void;
  onResetWindowLayout: () => void;
}

/** Support's own menu, on the plate's title: every command of the plate but the switches. */
export function buildSupportPlateMenu(options: SupportPlateMenuOptions): SetupMenu {
  const busyReason = options.busy ? "another action is running" : null;
  const items: MenuEntry[] = [
    {
      id: "export-backup",
      label: "Export backup",
      disabledReason: busyReason,
      onSelect: options.onExportBackup,
      testId: "support-plate-menu-export-backup",
    },
    {
      id: "verify-latest",
      label: "Verify latest",
      disabledReason: busyReason ?? options.noBackupReason,
      onSelect: options.onVerifyLatest,
      testId: "support-plate-menu-verify-latest",
    },
    {
      id: "restore-latest",
      label: "Restore latest…",
      disabledReason: busyReason ?? options.noBackupReason,
      onSelect: options.onRestoreLatest,
      testId: "support-plate-menu-restore-latest",
    },
    { kind: "divider", id: "diagnostics" },
    {
      id: "export-diagnostics",
      label: "Export diagnostics",
      disabledReason: busyReason,
      onSelect: options.onExportDiagnostics,
      testId: "support-plate-menu-export-diagnostics",
    },
    {
      id: "open-log",
      label: "Open the log",
      disabledReason: busyReason ?? (options.canOpenLog ? null : "no log file reported"),
      onSelect: options.onOpenLog,
      testId: "support-plate-menu-open-log",
    },
    { kind: "divider", id: "window" },
    {
      id: "studio-fullscreen",
      label: "Studio fullscreen",
      disabledReason: busyReason,
      onSelect: options.onStudioFullscreen,
      testId: "support-plate-menu-studio-fullscreen",
    },
    {
      id: "reset-window",
      label: "Reset the window layout",
      disabledReason: busyReason,
      onSelect: options.onResetWindowLayout,
      testId: "support-plate-menu-reset-window",
    },
  ];
  return { head: { title: "Support", detail: "this workstation" }, items };
}

export interface CameraSetupMenuOptions {
  camera: number;
  tag: string;
  model: string;
  /** CAM 1's link is Bluetooth: it is paired, not addressed. */
  bluetooth: boolean;
  paired: boolean;
  setUp: boolean;
  /** The hardware link's reason it takes no pairing or address yet; `null` once it does. */
  noLink: string | null;
  busy: boolean;
  onPair: () => void;
  onForget: () => void;
}

/** A camera's menu on the Cameras screen: pairing, and `Forget CAM n…`, which arms in place. */
export function buildCameraSetupMenu(options: CameraSetupMenuOptions): SetupMenu {
  const { camera, tag, busy } = options;
  const busyReason = busy ? "another action is running" : null;
  const items: MenuEntry[] = options.bluetooth
    ? [
        {
          id: "pair",
          label: `Pair ${tag}`,
          value: options.paired ? "paired" : undefined,
          disabledReason: busyReason ?? options.noLink ?? (options.paired ? "paired already" : null),
          onSelect: options.onPair,
          testId: `setup-camera-menu-${camera}-pair`,
        },
      ]
    : [];
  return {
    head: { title: tag, detail: options.model },
    items,
    destructive: {
      id: setupMenuArmId.forget(camera),
      label: `Forget ${tag}…`,
      armedLabel: `Press again to forget ${tag}`,
      disabledReason: busyReason ?? (options.setUp ? null : "not set up"),
      onConfirm: options.onForget,
      testId: `setup-camera-${camera}-forget`,
    },
  };
}
