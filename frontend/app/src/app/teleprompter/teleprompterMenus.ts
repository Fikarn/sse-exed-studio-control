import type { MenuContent, MenuEntry } from "@sse/design-system";
import type { PrompterScriptSummary } from "@sse/engine-client";

import { scriptLine } from "./teleprompterModel";
import { teleprompterMenuArmId } from "./useTeleprompterArming";

// The visual overhaul's Teleprompter page (2026-10-05, DESIGN.md §9): one
// builder per object, as `camerasMenus.ts` and `lightingMenus.ts` have. A
// script's menu is shared by its row's ⋯, a right-click on the row and the
// plate title's ⋯; a removed script's by its row's ⋯ and a right-click on it;
// the Scripts section's by its ⋯. Each host passes the page's arm
// (`menu={{ ...menu, arm }}`) and owns the dialog or popover an item opens.
//
// Nothing here applies a press twice (D11). Remove is one press, as it always
// was. Replace hands off to the plate's fixed key: the item selects the script
// and arms that key, which takes the second press. Update and Clear have no
// item: they stay the page's own keys. Delete for good is the removed
// script's destructive item, which arms in place, since nothing undoes it.

export type TeleprompterMenu = Omit<MenuContent, "arm">;

/** What is on the prompter, as one script's menu sees it. */
export type OnPrompter = "nothing" | "this" | "another";

export interface ScriptMenuOptions {
  script: PrompterScriptSummary;
  /** The script is the selected one: the plate shows it. */
  selected: boolean;
  onPrompter: OnPrompter;
  /** The plate title's menu: its script is the selected one, and the plate's own keys stand under it. */
  onPlate?: boolean;
  /** How many earlier versions it keeps, once read (the selected script's only). */
  versions?: number | null;
  onSelect: () => void;
  /** One press: the prompter is blank. */
  onPutOn: () => void;
  /** Selects the script and arms the plate's Replace key; never the second press. */
  onReplace: () => void;
  onEdit: () => void;
  onRename: () => void;
  onVersions: () => void;
  onRemove: () => void;
  testIdPrefix: string;
}

export function buildScriptMenu(options: ScriptMenuOptions): TeleprompterMenu {
  const { script, selected, onPrompter, onPlate = false, versions = null, testIdPrefix } = options;
  const items: MenuEntry[] = [];
  if (!onPlate) {
    items.push({
      id: "select",
      label: "Select",
      value: selected ? "selected" : undefined,
      disabledReason: selected ? "selected" : null,
      onSelect: options.onSelect,
      testId: `${testIdPrefix}-select`,
    });
    if (onPrompter === "nothing") {
      items.push({
        id: "put-on",
        label: "Put on the prompter",
        onSelect: options.onPutOn,
        testId: `${testIdPrefix}-put-on`,
      });
    } else if (onPrompter === "another") {
      items.push({
        id: "replace",
        label: "Replace on the prompter…",
        value: "on the plate",
        onSelect: options.onReplace,
        testId: `${testIdPrefix}-replace`,
      });
    }
  }
  items.push(
    {
      id: "edit",
      label: "Edit script",
      onSelect: options.onEdit,
      testId: `${testIdPrefix}-edit`,
    },
    { kind: "divider", id: "organise" },
    {
      id: "rename",
      label: "Rename…",
      onSelect: options.onRename,
      testId: `${testIdPrefix}-rename`,
    },
    {
      id: "versions",
      label: "Earlier versions…",
      value: versions === null ? undefined : `${versions} kept`,
      onSelect: options.onVersions,
      testId: `${testIdPrefix}-versions`,
    },
    { kind: "divider", id: "remove-divider" },
    {
      id: "remove",
      label: "Remove",
      value: onPrompter === "this" ? undefined : "to Removed",
      disabledReason: onPrompter === "this" ? "on the prompter · clear it first" : null,
      onSelect: options.onRemove,
      testId: `${testIdPrefix}-remove`,
    }
  );
  return {
    head: { title: script.name, detail: onPrompter === "this" ? "On the prompter" : scriptLine(script) },
    items,
  };
}

export interface RemovedMenuOptions {
  script: PrompterScriptSummary;
  onRestore: () => void;
  /** At the destructive item's second press. */
  onDelete: () => void;
}

/** A removed script's menu: Restore, and Delete for good, which arms in place and cannot be undone. */
export function buildRemovedMenu({ script, onRestore, onDelete }: RemovedMenuOptions): TeleprompterMenu {
  return {
    head: { title: script.name, detail: "Removed · a delete for good cannot be undone" },
    items: [
      {
        id: "restore",
        label: "Restore",
        value: "to Scripts",
        onSelect: onRestore,
        testId: `teleprompter-restore-${script.id}`,
      },
    ],
    destructive: {
      id: teleprompterMenuArmId.delete(script.id),
      label: "Delete for good…",
      armedLabel: `Press again to delete ${script.name} for good`,
      onConfirm: onDelete,
      testId: `teleprompter-delete-${script.id}`,
    },
  };
}

export interface ScriptsViewMenuOptions {
  showRemoved: boolean;
  scripts: number;
  removed: number;
  onShow: (removed: boolean) => void;
}

/** The Scripts section's ⋯: which list it shows, as Audio's tiers filter theirs. */
export function buildScriptsViewMenu({
  showRemoved,
  scripts,
  removed,
  onShow,
}: ScriptsViewMenuOptions): TeleprompterMenu {
  return {
    head: {
      title: showRemoved ? "Removed" : "Scripts",
      detail: showRemoved ? "the most recently removed first" : "sorted by name",
    },
    items: [
      { kind: "label", id: "show", label: "Show" },
      {
        kind: "radio",
        id: "scripts",
        label: "Scripts",
        value: String(scripts),
        checked: !showRemoved,
        onSelect: () => onShow(false),
        testId: "teleprompter-show-scripts",
      },
      {
        kind: "radio",
        id: "removed",
        label: "Removed",
        value: String(removed),
        checked: showRemoved,
        onSelect: () => onShow(true),
        testId: "teleprompter-removed",
      },
    ],
  };
}
