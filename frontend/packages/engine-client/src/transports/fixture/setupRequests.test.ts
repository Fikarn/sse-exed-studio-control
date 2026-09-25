import { describe, expect, it } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { EventName, JsonObject, RequestMethod } from "../../generated/protocol";
import type { FixtureScenario } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";
import { cloneJson } from "./json";

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

// New pages program, Slice 2b (D3): the db.json import is retired. The hardware link lists
// every `.json` in the backups folder, an export from the old Studio Control included, and
// refuses one at Verify (ok: false) and at Restore (INVALID_PARAMS, before anything is
// written, a rollback archive included), in the words the double uses too. The double
// recognizes the file by its name; the hardware link reads what is inside.

const OLD_EXPORT_REFUSAL =
  "db.json is an export from the old Studio Control (db.json); this version no longer restores those. Restore a backup archive or a database backup instead.";

/** A set-up-required double whose backups folder holds an export from the old Studio Control. */
function openDoubleWithOldExport() {
  const scenario = cloneJson(getFixtureScenario("setup-required") as JsonObject) as FixtureScenario;
  const support = scenario.supportSnapshot as JsonObject;
  const path = `${String(support.backupDir)}/db.json`;
  support.backups = [{ kind: "archive", name: "db.json", path, sizeBytes: 2048, modifiedAt: 1776841920000 }];
  const transport = createFixtureTransport(scenario);
  const events: EventName[] = [];
  transport.subscribe((envelope) => events.push(envelope.event));
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  const readEverything = async () =>
    Promise.all(
      (["app.snapshot", "commissioning.snapshot", "health.snapshot", "support.snapshot"] as const).map((method) =>
        request(method)
      )
    );
  return { request, events, path, readEverything };
}

describe("the fixture double and an export from the old Studio Control (db.json)", () => {
  it("lists it, and Verify says it is not restored any more", async () => {
    const { request, path } = openDoubleWithOldExport();
    const listed = (await request("support.snapshot")).backups as JsonObject[];
    expect(listed.map((entry) => entry.path)).toEqual([path]);

    const verified = await request("support.backup.verify", { path });
    expect(verified).toEqual({ detail: OLD_EXPORT_REFUSAL, kind: "archive", ok: false, path });
  });

  it("refuses to restore it and writes nothing, a rollback backup included", async () => {
    const { request, events, path, readEverything } = openDoubleWithOldExport();
    const before = await readEverything();
    expect((before[1] as JsonObject).hasCompletedSetup).toBe(false);

    await expect(request("support.backup.restore", { path })).rejects.toThrow(OLD_EXPORT_REFUSAL);

    expect(await readEverything()).toEqual(before);
    expect(events).toEqual([]);
    expect(((await request("support.snapshot")).backups as JsonObject[]).map((entry) => entry.path)).toEqual([path]);
  });

  it("answers a db.json that is not in the backups folder as any file not found", async () => {
    const { request } = openDouble();
    const backupDir = String((await request("support.snapshot")).backupDir);
    const missing = `${backupDir}/db.json`;

    for (const method of ["support.backup.verify", "support.backup.restore"] as const) {
      await expect(request(method, { path: missing })).rejects.toThrow(`Backup file was not found: ${missing}`);
    }
  });

  it("gives every scenario the hardware link's restore sentence, which names no db.json", async () => {
    const hardwareLinkSentence =
      "Restore a backup archive or a database backup from the backups folder. A rollback backup is written first; a database backup takes effect once Studio Control has restarted its hardware link.";
    for (const id of fixtureIds) {
      const transport = createFixtureTransport(getFixtureScenario(id));
      const support = (await transport.request("support.snapshot", {})) as JsonObject;
      expect(support.restoreSummary, id).toBe(hardwareLinkSentence);
    }
  });
});
