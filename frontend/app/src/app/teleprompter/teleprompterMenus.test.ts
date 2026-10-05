import { describe, expect, it, vi } from "vitest";

import type { MenuActionItem, MenuEntry, MenuRadioItem } from "@sse/design-system";
import type { PrompterGlassSummary, PrompterScriptSummary, PrompterSnapshot } from "@sse/engine-client";

import { buildRemovedMenu, buildScriptMenu, buildScriptsViewMenu, type ScriptMenuOptions } from "./teleprompterMenus";
import {
  armName,
  armStillStands,
  CLEAR_ARM_KEY,
  deleteArmedFor,
  menuArmKey,
  replaceArmedFor,
  teleprompterArmedWords,
  teleprompterArmKey,
  teleprompterMenuArmId,
  UPDATE_ARM_KEY,
} from "./useTeleprompterArming";

// The visual overhaul's Teleprompter page (2026-10-05): one menu per object,
// and one arm for the page. Nothing in a menu applies a press twice: Replace
// hands off to the plate's key, Update and Clear have no item, and Delete for
// good arms in place.

function script(id: string, name: string, overrides: Partial<PrompterScriptSummary> = {}): PrompterScriptSummary {
  return {
    id,
    name,
    sourceFileName: null,
    paragraphCount: 5,
    readWords: 171,
    speedWpm: 140,
    lengthSeconds: 73,
    place: { paragraph: 0, word: 0 },
    atEnd: false,
    createdAt: "2026-10-05T08:00:00Z",
    changedAt: "2026-10-05T08:00:00Z",
    removedAt: null,
    onPrompter: false,
    ...overrides,
  };
}

const WELCOME = script("s1", "01 Welcome");
const INTRO = script("s2", "02 Interview intro", { onPrompter: true });
const OUTRO = script("s4", "04 Outro");
const DRAFT = script("r1", "Draft intro", { removedAt: "2026-10-05T07:00:00Z" });

/** The glass as far as the arm reads it: what is on it, and whether it is updated. */
function onGlass(overrides: Partial<PrompterGlassSummary> = {}): PrompterGlassSummary {
  return { scriptId: INTRO.id, name: INTRO.name, notUpdated: false, ...overrides } as PrompterGlassSummary;
}

function prompter(glass: PrompterGlassSummary | null): Pick<PrompterSnapshot, "glass" | "scripts" | "removed"> {
  return { glass, scripts: [WELCOME, INTRO, OUTRO], removed: [DRAFT] };
}

function options(overrides: Partial<ScriptMenuOptions> & Pick<ScriptMenuOptions, "script">): ScriptMenuOptions {
  return {
    selected: false,
    onPrompter: "another",
    onSelect: vi.fn(),
    onPutOn: vi.fn(),
    onReplace: vi.fn(),
    onEdit: vi.fn(),
    onRename: vi.fn(),
    onVersions: vi.fn(),
    onRemove: vi.fn(),
    testIdPrefix: "menu",
    ...overrides,
  };
}

const ids = (items: readonly MenuEntry[]) => items.map((entry) => (entry.kind === "divider" ? "—" : entry.id));
const item = (items: readonly MenuEntry[], id: string) =>
  items.find((entry) => entry.kind !== "divider" && entry.id === id) as MenuActionItem | undefined;

describe("a script's menu", () => {
  it("names the script, and hands another script's Replace to the plate's key", () => {
    const onReplace = vi.fn();
    const menu = buildScriptMenu(options({ script: OUTRO, onReplace }));
    expect(menu.head).toEqual({ title: "04 Outro", detail: "1:13 at 140 · 171 words" });
    expect(ids(menu.items)).toEqual(["select", "replace", "edit", "—", "rename", "versions", "—", "remove"]);
    expect(item(menu.items, "replace")).toMatchObject({
      label: "Replace on the prompter…",
      value: "on the plate",
      testId: "menu-replace",
    });
    // Replace is never the menu's own arm: no destructive item, so the menu
    // cannot apply it; the item only hands it off.
    expect(menu.destructive).toBeUndefined();
    item(menu.items, "replace")!.onSelect();
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it("puts a script on a blank prompter with one press, and has no Update or Clear item ever", () => {
    for (const onPrompter of ["nothing", "another", "this"] as const) {
      const menu = buildScriptMenu(options({ script: INTRO, onPrompter }));
      expect(ids(menu.items)).not.toContain("update");
      expect(ids(menu.items)).not.toContain("clear");
      expect(menu.destructive).toBeUndefined();
    }
    const blank = buildScriptMenu(options({ script: OUTRO, onPrompter: "nothing" }));
    expect(ids(blank.items)).toEqual(["select", "put-on", "edit", "—", "rename", "versions", "—", "remove"]);
  });

  it("locks Remove while its script is on the prompter, and says why", () => {
    const menu = buildScriptMenu(options({ script: INTRO, onPrompter: "this", selected: true }));
    expect(menu.head?.detail).toBe("On the prompter");
    expect(item(menu.items, "select")).toMatchObject({ value: "selected", disabledReason: "selected" });
    expect(item(menu.items, "remove")).toMatchObject({ disabledReason: "on the prompter · clear it first" });
    expect(ids(menu.items)).not.toContain("replace");
  });

  it("on the plate's title keeps the old keys' test ids and leaves Select, Put on and Replace to the plate", () => {
    const menu = buildScriptMenu(
      options({ script: OUTRO, selected: true, onPlate: true, versions: 4, testIdPrefix: "teleprompter" })
    );
    expect(ids(menu.items)).toEqual(["edit", "—", "rename", "versions", "—", "remove"]);
    expect(item(menu.items, "rename")!.testId).toBe("teleprompter-rename");
    expect(item(menu.items, "versions")).toMatchObject({ testId: "teleprompter-versions", value: "4 kept" });
    expect(item(menu.items, "remove")!.testId).toBe("teleprompter-remove");
  });

  it("never gives a row's test ids the prefix the page's spec counts rows by", () => {
    const menu = buildScriptMenu(options({ script: OUTRO, testIdPrefix: `teleprompter-row-menu-${OUTRO.id}` }));
    for (const entry of menu.items) {
      if (entry.kind === "divider" || entry.kind === "label") continue;
      expect(entry.testId?.startsWith("teleprompter-script-")).toBe(false);
    }
  });
});

describe("a removed script's menu", () => {
  it("restores in one press, and deletes for good only at the destructive item's second press", () => {
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    const menu = buildRemovedMenu({ script: DRAFT, onRestore, onDelete });
    expect(menu.head).toEqual({ title: "Draft intro", detail: "Removed · a delete for good cannot be undone" });
    expect(item(menu.items, "restore")!.testId).toBe("teleprompter-restore-r1");
    expect(menu.destructive).toMatchObject({
      id: "delete:r1",
      label: "Delete for good…",
      armedLabel: "Press again to delete Draft intro for good",
      testId: "teleprompter-delete-r1",
    });
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("the Scripts section's menu", () => {
  it("switches between the scripts and the removed ones, with their counts", () => {
    const onShow = vi.fn();
    const menu = buildScriptsViewMenu({ showRemoved: false, scripts: 6, removed: 2, onShow });
    const radios = menu.items.filter((entry): entry is MenuRadioItem => entry.kind === "radio");
    expect(radios.map((entry) => [entry.testId, entry.value, entry.checked])).toEqual([
      ["teleprompter-show-scripts", "6", true],
      ["teleprompter-removed", "2", false],
    ]);
    radios[1]!.onSelect();
    expect(onShow).toHaveBeenCalledWith(true);
  });
});

describe("the page's one arm", () => {
  it("names each arm's key by one rule", () => {
    expect(teleprompterArmKey.replace("s4")).toBe("replace:s4");
    expect(menuArmKey(teleprompterMenuArmId.delete("r1"))).toBe("menu:delete:r1");
    expect(replaceArmedFor("replace:s4")).toBe("s4");
    expect(replaceArmedFor(UPDATE_ARM_KEY)).toBeNull();
    expect(deleteArmedFor("menu:delete:r1")).toBe("r1");
    expect(deleteArmedFor("delete:r1")).toBeNull();
  });

  it("says what the second press does, from what the page shows now", () => {
    const now = prompter(onGlass());
    const say = (key: string) => teleprompterArmedWords({ key, label: "at rest" }, now);
    expect(say(UPDATE_ARM_KEY)).toBe("Update 02 Interview intro");
    expect(say(CLEAR_ARM_KEY)).toBe("Clear the prompter");
    expect(say("replace:s4")).toBe("Replace with 04 Outro");
    // The menu arms with its item's words at rest; the row says it as the page does.
    expect(say("menu:delete:r1")).toBe("Delete Draft intro for good");
    expect(say("replace:gone")).toBe("at rest");
    expect(armName("A script with a name far too long for the row")).toBe("A script with a nam…");
  });

  it("drops Update once NOT UPDATED has cleared, so the row never asks for a key that is gone", () => {
    expect(armStillStands(UPDATE_ARM_KEY, prompter({ ...onGlass(), notUpdated: true }), INTRO.id)).toBe(true);
    expect(armStillStands(UPDATE_ARM_KEY, prompter(onGlass()), INTRO.id)).toBe(false);
    expect(armStillStands(UPDATE_ARM_KEY, prompter(null), INTRO.id)).toBe(false);
  });

  it("drops Clear on a blank prompter, and Replace when its script is not the selected one or is on the prompter", () => {
    expect(armStillStands(CLEAR_ARM_KEY, prompter(onGlass()), null)).toBe(true);
    expect(armStillStands(CLEAR_ARM_KEY, prompter(null), null)).toBe(false);
    expect(armStillStands("replace:s4", prompter(onGlass()), OUTRO.id)).toBe(true);
    expect(armStillStands("replace:s4", prompter(onGlass()), WELCOME.id)).toBe(false);
    expect(armStillStands("replace:s2", prompter(onGlass()), INTRO.id)).toBe(false);
    expect(armStillStands("replace:s4", prompter(null), OUTRO.id)).toBe(false);
    expect(armStillStands("replace:gone", prompter(onGlass()), "gone")).toBe(false);
  });

  it("drops Delete for good once its script is no longer among the removed", () => {
    expect(armStillStands("menu:delete:r1", prompter(onGlass()), null)).toBe(true);
    expect(armStillStands("menu:delete:r1", { ...prompter(onGlass()), removed: [] }, null)).toBe(false);
  });
});
