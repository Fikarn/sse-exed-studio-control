/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { fixtureIds, getFixtureScenario } from "@sse/test-fixtures";

import type { EventName, JsonObject, RequestMethod } from "../../generated/protocol";
import type { FixtureScenario } from "../../types";
import { createFixtureTransport } from "../fixtureTransport";
import { cloneJson } from "./json";
import { WORKSPACES, workspaceRefusal } from "./setupRequests";

// New pages program, Slice 2 (D3): the fixture double's backup replies say what the
// hardware link says (`native/rust-engine/src/support.rs`). The export's reply counts
// nothing of Planning; an archive written before Planning left is format 4; no reply
// counts projects, tasks, checklist items or activity entries, and none says a Planning
// part was skipped, because the double never held Planning data. Slice 4: a new archive
// is format 6, with the Teleprompter's part, and Verify counts its scripts. Slice 8: format
// 7, with the cameras' part too, which Verify names.

const PLANNING_COUNTS = ["projectCount", "taskCount", "checklistItemCount", "activityEntryCount"];

function openDouble() {
  const transport = createFixtureTransport(getFixtureScenario("setup-ready"));
  const request = (method: RequestMethod, params: JsonObject = {}) =>
    transport.request(method, params) as Promise<JsonObject>;
  return { transport, request };
}

describe("the fixture double's backup replies", () => {
  it("exports a format-7 archive and verifies it as one, counting its scripts and naming the cameras' setup", async () => {
    const { request } = openDouble();

    const exported = await request("support.backup.export");
    expect(Object.keys(exported).sort()).toEqual(["fileName", "formatVersion", "path"]);
    expect(exported.formatVersion).toBe(7);

    const verified = await request("support.backup.verify", { path: exported.path as string });
    expect(verified).toMatchObject({ formatVersion: 7, kind: "archive", ok: true });
    expect(verified.detail).toMatch(/^Backup archive, format 7, exported .+, with 0 scripts and the cameras' setup\.$/);
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
    expect(String(verified.detail)).not.toMatch(/project|task|Planning|script/);
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

  // Format 6 (Slice 4; the hardware link's `a_format_6_archive_adds_scripts_and_never_removes_one`):
  // a restore adds the scripts the double lacks and never removes or overwrites one — a
  // differing text comes back as an earlier version — brings the look back, and leaves
  // what the prompter shows paused where it was (D12).
  it("restores the Teleprompter's part: adds scripts, never removes one, brings the look back", async () => {
    const { request, transport } = openDouble();
    const create = async (name: string, text: string) => {
      const id = (await request("prompter.script.create", { name })).scriptId as string;
      await request("prompter.script.edit", {
        scriptId: id,
        paragraphs: [{ runs: [{ text }] }, { runs: [{ text: "Second." }] }],
      });
      return id;
    };
    const intro = await create("Intro", "Welcome as archived.");
    const spare = await create("Spare", "Spare words.");
    await request("prompter.putOn", { scriptId: spare });
    await request("prompter.clear");
    await request("prompter.script.remove", { scriptId: spare });
    await request("prompter.look.update", { textColour: "yellow" });

    const exported = await request("support.backup.export");
    const path = exported.path as string;
    expect((await request("support.backup.verify", { path })).detail).toMatch(
      /, with 2 scripts and the cameras' setup\.$/
    );

    await request("prompter.script.edit", {
      scriptId: intro,
      paragraphs: [{ runs: [{ text: "Welcome as edited." }] }, { runs: [{ text: "Second." }] }],
    });
    await request("prompter.putOn", { scriptId: intro });
    await request("prompter.jump", { to: "paragraph", paragraph: 1 });
    await request("prompter.script.delete", { scriptId: spare });
    await request("prompter.script.create", { name: "Newer" });
    await request("prompter.look.update", { textColour: "white" });
    const glassBefore = await request("prompter.glass.snapshot");

    const events: JsonObject[] = [];
    transport.subscribe((envelope) => events.push({ event: envelope.event, ...envelope.payload }));
    const restored = await request("support.backup.restore", { path });
    expect(restored.detail).toBe(
      "1 script added to the Teleprompter; 1 script came back as an earlier version of a script already here."
    );
    expect(events.map((event) => event.event)).toEqual([
      "support.changed",
      "commissioning.changed",
      "app.changed",
      "prompter.changed",
      // Slice 8: the cameras take their setup again (`after_restore_cameras`).
      "cameras.changed",
    ]);
    expect(events[3]).toMatchObject({ reason: "backup-restored", anchor: { playing: false } });
    expect(events[4]).toEqual({ event: "cameras.changed", reason: "restore", camera: null });

    const snapshot = await request("prompter.snapshot");
    expect((snapshot.look as JsonObject).textColour).toBe("yellow");
    expect((snapshot.scripts as JsonObject[]).map((row) => row.name)).toEqual(["Intro", "Newer"]);
    expect((snapshot.removed as JsonObject[]).map((row) => row.id)).toEqual([spare]);
    const introNow = await request("prompter.script.snapshot", { scriptId: intro });
    expect((introNow.paragraphs as JsonObject[])[0]).toMatchObject({ runs: [{ text: "Welcome as edited." }] });
    expect((introNow.versions as JsonObject[])[0]?.reason).toBe("from-backup");
    const spareNow = await request("prompter.script.snapshot", { scriptId: spare });
    expect((spareNow.versions as JsonObject[])[0]?.reason).toBe("put-on");

    const glassAfter = await request("prompter.glass.snapshot");
    expect(glassAfter.paragraphs).toEqual(glassBefore.paragraphs);
    expect(glassAfter.scriptId).toBe(intro);
    expect((snapshot.glass as JsonObject).place).toEqual({ paragraph: 1, word: 0 });

    // A second restore of the same archive adds nothing more.
    expect(await request("support.backup.restore", { path })).not.toHaveProperty("detail");
  });

  // The hardware link's `the_archive_carries_an_edited_glass_script_s_place_in_its_own_text`
  // (review of 2026-09-27, M1): while the script on the glass has an edit that was never
  // Updated, the archive carries its place in its own text.
  it("carries an edited glass script's place in its own text", async () => {
    const { request } = openDouble();
    const talk = (await request("prompter.script.create", { name: "Talk" })).scriptId as string;
    const paragraphs = Array.from({ length: 6 }, (_, index) => ({
      runs: [{ text: `Paragraph number ${index} here.` }],
    }));
    await request("prompter.script.edit", { scriptId: talk, paragraphs });
    await request("prompter.putOn", { scriptId: talk });
    await request("prompter.jump", { to: "paragraph", paragraph: 4 });
    await request("prompter.script.edit", {
      scriptId: talk,
      paragraphs: paragraphs.filter((_, index) => index !== 1),
    });
    const path = (await request("support.backup.export")).path as string;

    // The archived place, read back: the script deleted for good comes back from it.
    await request("prompter.clear");
    await request("prompter.script.remove", { scriptId: talk });
    await request("prompter.script.delete", { scriptId: talk });
    await request("support.backup.restore", { path });
    const restored = await request("prompter.script.snapshot", { scriptId: talk });
    expect((restored.script as JsonObject).place).toEqual({ paragraph: 3, word: 0 });
  });
});

// Slice 4: `settings.update` opens the pages the hardware link knows and refuses any
// other with its sentence. The list is read from `shell_settings.rs` itself, so a page
// added or taken away on one side only fails here.

const SHELL_SETTINGS_RS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/shell_settings.rs"),
  "utf-8"
);

function hardwareLinkWorkspaces(): string[] {
  const list = SHELL_SETTINGS_RS.match(/\bpub const WORKSPACES: &\[&str\] = &\[([^\]]*)\];/)?.[1];
  if (list === undefined) throw new Error("WORKSPACES is not in shell_settings.rs any more; update this test with it");
  return [...list.matchAll(/"([^"\\]*)"/g)].map((entry) => entry[1]!);
}

function hardwareLinkWorkspaceRefusal(): string {
  const format = SHELL_SETTINGS_RS.match(
    /\bpub fn workspace_refusal\(\) -> String \{\s*format!\(\s*"([^"\\]*)",\s*WORKSPACES\.join\(", "\)\s*\)/
  )?.[1];
  if (format === undefined || format.split("{}").length !== 2) {
    throw new Error('workspace_refusal is not format!("…{}", WORKSPACES.join(", ")) any more; update this test');
  }
  return format.replace("{}", hardwareLinkWorkspaces().join(", "));
}

describe("the fixture double's pages", () => {
  it("knows the hardware link's pages, in its order", () => {
    expect([...WORKSPACES]).toEqual(hardwareLinkWorkspaces());
    expect(workspaceRefusal()).toBe(hardwareLinkWorkspaceRefusal());
  });

  it("opens the Teleprompter and refuses a page it does not know, changing nothing", async () => {
    const { request, transport } = openDouble();
    const events: EventName[] = [];
    transport.subscribe((envelope) => events.push(envelope.event));

    const opened = await request("settings.update", { workspace: "teleprompter" });
    expect((opened.shell as JsonObject).workspace).toBe("teleprompter");
    expect(events).toEqual(["settings.changed"]);
    const before = await request("app.snapshot");

    // The whole request is refused, the Setup section it also names included.
    const otherSection =
      ((before.shell as JsonObject).setup as JsonObject).activeSection === "support" ? "commissioning" : "support";
    for (const unknown of ["Cameras", "Teleprompter", "planning", ""]) {
      await expect(
        request("settings.update", { workspace: unknown, setup: { activeSection: otherSection } })
      ).rejects.toThrow(hardwareLinkWorkspaceRefusal());
    }
    await expect(request("settings.update", { workspace: 3 })).rejects.toThrow("workspace must be a string");
    expect(await request("app.snapshot")).toEqual(before);
    expect(events).toEqual(["settings.changed"]);
  });
});

// New pages program, Slice 2b (D3): the db.json import is retired. The hardware link lists
// every `.json` in the backups folder, an export from the old Studio Control included, and
// refuses one at Verify (ok: false) and at Restore (INVALID_PARAMS, before anything is
// written, a rollback archive included), in the words the double uses too. The double
// recognizes the file by its name; the hardware link reads what is inside.
//
// The two sentences the double shares with the hardware link, that refusal and the Support
// snapshot's restore summary, are read from `support.rs` itself (as actionLog.test.ts reads
// `action_log.rs`), so a sentence reworded on one side only fails here. The hardware link
// builds the refusal with `format!` and the file's name; the double's is compared with that
// format string, the name filled in.

const SUPPORT_RS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../native/rust-engine/src/support.rs"),
  "utf-8"
);

/** The plain string literal `pattern` captures in `support.rs`; loud when it is gone or holds an escape. */
function supportRsString(pattern: RegExp, what: string): string {
  const literal = SUPPORT_RS.match(pattern)?.[1];
  if (literal === undefined) {
    throw new Error(`${what} is not in support.rs any more as one plain string literal; update this test with it`);
  }
  return literal;
}

/** The hardware link's `restoreSummary` (`let restore_summary = String::from("…")` in `support_snapshot`). */
function hardwareLinkRestoreSummary(): string {
  return supportRsString(/\blet restore_summary = String::from\(\s*"([^"\\]*)",?\s*\);/, "The restore summary");
}

/** The hardware link's refusal of an old export: `old_studio_control_export_sentence`'s format string, filled in. */
function hardwareLinkOldExportRefusal(fileName: string): string {
  const format = supportRsString(
    /\bfn old_studio_control_export_sentence\(path: &Path\) -> String \{(?:(?!\r?\n\})[\s\S])*?\bformat!\(\s*"([^"\\]*)"\s*,?\s*\)/,
    "old_studio_control_export_sentence's format string"
  );
  const parts = format.split("{file_name}");
  if (parts.length !== 2 || /[{}]/.test(parts.join(""))) {
    throw new Error(`old_studio_control_export_sentence's format string is not "…{file_name}…" any more: ${format}`);
  }
  return parts.join(fileName);
}

/** A set-up-required double whose backups folder holds an export from the old Studio Control. */
function openDoubleWithOldExport(fileName = "db.json") {
  const scenario = cloneJson(getFixtureScenario("setup-required") as JsonObject) as FixtureScenario;
  const support = scenario.supportSnapshot as JsonObject;
  const path = `${String(support.backupDir)}\\${fileName}`;
  support.backups = [{ kind: "archive", name: fileName, path, sizeBytes: 2048, modifiedAt: 1776841920000 }];
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
    expect(verified).toEqual({ detail: hardwareLinkOldExportRefusal("db.json"), kind: "archive", ok: false, path });
  });

  it("refuses to restore it and writes nothing, a rollback backup included", async () => {
    const { request, events, path, readEverything } = openDoubleWithOldExport();
    const before = await readEverything();
    expect((before[1] as JsonObject).hasCompletedSetup).toBe(false);

    await expect(request("support.backup.restore", { path })).rejects.toThrow(hardwareLinkOldExportRefusal("db.json"));

    expect(await readEverything()).toEqual(before);
    expect(events).toEqual([]);
    expect(((await request("support.snapshot")).backups as JsonObject[]).map((entry) => entry.path)).toEqual([path]);
  });

  it("answers a db.json that is not in the backups folder as any file not found", async () => {
    const { request } = openDouble();
    const backupDir = String((await request("support.snapshot")).backupDir);
    const missing = `${backupDir}\\db.json`;

    for (const method of ["support.backup.verify", "support.backup.restore"] as const) {
      await expect(request(method, { path: missing })).rejects.toThrow(`Backup file was not found: ${missing}`);
    }
  });

  it("refuses Verify and Restore in the hardware link's own words, with the file's own name", async () => {
    const fileName = "studio-control-2024-db.json";
    const refusal = hardwareLinkOldExportRefusal(fileName);
    const { request, path } = openDoubleWithOldExport(fileName);

    expect(await request("support.backup.verify", { path })).toEqual({
      detail: refusal,
      kind: "archive",
      ok: false,
      path,
    });
    await expect(request("support.backup.restore", { path })).rejects.toHaveProperty("message", refusal);
  });

  it("gives every scenario the hardware link's restore sentence, which names no db.json", async () => {
    const hardwareLinkSentence = hardwareLinkRestoreSummary();
    expect(hardwareLinkSentence).not.toMatch(/db\.json/);
    for (const id of fixtureIds) {
      const transport = createFixtureTransport(getFixtureScenario(id));
      const support = (await transport.request("support.snapshot", {})) as JsonObject;
      expect(support.restoreSummary, id).toBe(hardwareLinkSentence);
    }

    // A scenario that brings no sentence of its own gets the double's (`state.ts`).
    const bare = cloneJson(getFixtureScenario("setup-ready") as JsonObject) as FixtureScenario;
    delete (bare.supportSnapshot as JsonObject).restoreSummary;
    const support = (await createFixtureTransport(bare).request("support.snapshot", {})) as JsonObject;
    expect(support.restoreSummary).toBe(hardwareLinkSentence);
  });
});
