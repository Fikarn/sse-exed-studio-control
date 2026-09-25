import { describe, expect, it } from "vitest";

import { getFixtureScenario } from "@sse/test-fixtures";

import type { JsonObject, RequestMethod } from "../../generated/protocol";
import { createFixtureTransport } from "../fixtureTransport";

// New pages program, Slice 2 (D3): the fixture double's backup replies say what the
// hardware link says (`native/rust-engine/src/support.rs`). A new archive is format 5 and
// the export's reply counts nothing of Planning; an archive written before Planning left
// is format 4; no reply counts projects, tasks, checklist items or activity entries, and
// none says a Planning part was skipped, because the double never held Planning data.

const PLANNING_COUNTS = ["projectCount", "taskCount", "checklistItemCount", "activityEntryCount"];

function openDouble() {
  const transport = createFixtureTransport(getFixtureScenario("setup-ready"));
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  return { transport, request };
}

describe("the fixture double's backup replies", () => {
  it("exports a format-5 archive and verifies it as one", async () => {
    const { request } = openDouble();

    const exported = await request("support.backup.export");
    expect(Object.keys(exported).sort()).toEqual(["fileName", "formatVersion", "path"]);
    expect(exported.formatVersion).toBe(5);

    const verified = await request("support.backup.verify", { path: exported.path as string });
    expect(verified).toMatchObject({ formatVersion: 5, kind: "archive", ok: true });
    expect(verified.detail).toMatch(/^Backup archive, format 5, exported .+\.$/);
    expect(String(verified.detail)).not.toMatch(/project|task|Planning/);
  });

  it("verifies the scenario's archive from before Planning left as format 4, with no Planning part", async () => {
    const { request } = openDouble();
    const snapshot = await request("support.snapshot");
    const older = (snapshot.backups as JsonObject[]).find((entry) => String(entry.name).endsWith(".json"));
    expect(older?.name).toBe("native-backup-2026-04-22T07-12-00.000Z.json");

    const verified = await request("support.backup.verify", { path: older!.path as string });
    expect(verified).toMatchObject({ formatVersion: 4, kind: "archive", ok: true });
    expect(verified.detail).toMatch(/^Backup archive, format 4, exported .+\.$/);
    expect(String(verified.detail)).not.toMatch(/project|task|Planning/);
  });

  it("restores with no Planning counts and nothing said to be left out", async () => {
    const { request } = openDouble();
    const exported = await request("support.backup.export");

    const restored = await request("support.backup.restore", { path: exported.path as string });
    expect(Object.keys(restored).sort()).toEqual([
      "requiresRestart",
      "rollbackBackupPath",
      "settingsRestored",
      "sourceFormat",
      "sourcePath",
    ]);
    for (const key of [...PLANNING_COUNTS, "detail"]) {
      expect(restored).not.toHaveProperty(key);
    }
    expect(restored).toMatchObject({ requiresRestart: false, sourceFormat: "native-support-backup" });
  });
});
