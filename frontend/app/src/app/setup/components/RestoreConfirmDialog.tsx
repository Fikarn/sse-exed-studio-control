import { ConfirmDialog } from "@sse/design-system";

import { formatBackupTimestamp, type SupportBackupEntry, type SupportBackupKind } from "../../shellData";

// Found, to check (2026-09-28): `Restore latest` and `Restore path` replaced the
// saved data at one press. They ask first now, as `CUT ALL` does, and the
// question says what the restore replaces. The answer is the kind of backup:
// a database backup replaces the whole file and restarts the hardware link, an
// archive rewrites the settings in place and adds scripts.

export interface RestorePrompt {
  /** The file the restore reads. */
  path: string;
  /** Which key asked: the action id the restore runs under. */
  actionId: "restore-latest" | "restore-path";
}

/** The kind of a backup, from the list when it is there, else from its name;
 *  `null` when neither says (a path typed by hand). */
export function restoreKindOf(path: string, backups: readonly SupportBackupEntry[]): SupportBackupKind | null {
  const listed = backups.find((backup) => backup.path === path);
  if (listed) return listed.kind;
  const lower = path.trim().toLowerCase();
  if (lower.endsWith(".sqlite3")) return "database";
  if (lower.endsWith(".json")) return "archive";
  return null;
}

function restoreBody(kind: SupportBackupKind | null) {
  if (kind === "database") {
    return "It replaces all the saved data: Setup, the lights and scenes, the Console, the deck, the scripts and the cameras' setup. The hardware link restarts into it. The saved data it replaces is kept in the backups folder.";
  }
  if (kind === "archive") {
    return "It replaces Setup, the lights and scenes, the Console's settings, the deck's settings and the cameras' setup. Scripts in it are added; none is removed. A copy of the settings it replaces is written to the backups folder first.";
  }
  return "A database backup replaces all the saved data and restarts the hardware link. A backup archive replaces Setup, the lights and scenes, the Console's and the deck's settings, and adds its scripts.";
}

export function RestoreConfirmDialog({
  prompt,
  backups,
  busy,
  onCancel,
  onConfirm,
}: {
  prompt: RestorePrompt;
  backups: readonly SupportBackupEntry[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kind = restoreKindOf(prompt.path, backups);
  const listed = backups.find((backup) => backup.path === prompt.path);
  const named = listed
    ? `${listed.kind === "database" ? "The database backup" : "The backup archive"} of ${formatBackupTimestamp(listed.modifiedAt)}`
    : `The backup at ${prompt.path}`;
  return (
    <ConfirmDialog
      body={`${named}. ${restoreBody(kind)}`}
      busy={busy}
      cancelLabel="Cancel"
      confirmLabel="Restore"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Restore this backup?"
    />
  );
}
