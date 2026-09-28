import { describe, expect, it } from "vitest";

import type { SupportBackupEntry } from "../../shellData";
import { restoreKindOf } from "./RestoreConfirmDialog";

const backups: SupportBackupEntry[] = [
  { kind: "database", modifiedAt: 0, name: "db-2026.sqlite3", path: "C:/b/db-2026.sqlite3", sizeBytes: 1 },
  { kind: "archive", modifiedAt: 0, name: "native-backup.json", path: "C:/b/native-backup.json", sizeBytes: 1 },
];

describe("restoreKindOf", () => {
  it("takes the kind from the list, then from the name, and else says nothing", () => {
    expect(restoreKindOf("C:/b/db-2026.sqlite3", backups)).toBe("database");
    expect(restoreKindOf("C:/b/native-backup.json", backups)).toBe("archive");
    expect(restoreKindOf("D:/elsewhere/copy.SQLITE3", backups)).toBe("database");
    expect(restoreKindOf("D:/elsewhere/copy.json", backups)).toBe("archive");
    expect(restoreKindOf("D:/elsewhere/copy", backups)).toBeNull();
  });
});
