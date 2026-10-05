import { Fragment, useEffect, useRef, useState } from "react";

import {
  ArmKey,
  ARM_TIMEOUT_MS,
  EmptyLine,
  Key,
  LampWord,
  MenuButton,
  PlateHead,
  Readouts,
  Section,
  Tooltip,
  type ArmedKey,
  type UseArmResult,
} from "@sse/design-system";
import type { PrompterScriptSnapshot, PrompterScriptSummary, PrompterSnapshot, ShellStore } from "@sse/engine-client";

import { RenameDialog } from "../shared/RenameDialog";
import { TeleprompterLook } from "./TeleprompterLook";
import { TeleprompterVersions } from "./TeleprompterVersions";
import { buildRemovedMenu, buildScriptMenu, buildScriptsViewMenu, type OnPrompter } from "./teleprompterMenus";
import { scriptDetailParts, scriptLine } from "./teleprompterModel";
import type { PerformAction } from "./perform";
import { teleprompterArmKey, UPDATE_ARM_KEY } from "./useTeleprompterArming";
import styles from "./TeleprompterPlate.module.css";

/** The longest script name the hardware link keeps (`MAX_SCRIPT_NAME_CHARS`). */
const SCRIPT_NAME_MAX_CHARS = 80;

// The Teleprompter's plate (new pages program, Slice 6a; board 1's right
// column, the proposal §2, §3.3 and §5.5): the selected script and the one key
// that puts it on the prompter — Put on the prompter, or Replace or Update ·
// press twice (D11) — the scripts sorted by name, and the look.
//
// The visual overhaul (2026-10-05): each script has one menu, opened by its
// row's ⋯, a right-click on the row, and, for the selected one, the plate
// title's ⋯: Select, Put on or Replace…, Edit script, Rename…, Earlier
// versions… and Remove. Replace from a menu hands off to the plate's fixed
// key, which takes the second press; nothing in a menu applies a press twice.
// Earlier versions open in a popover beside the title, and Removed is a view
// the Scripts section's ⋯ switches to; a removed script's menu holds Restore
// and Delete for good, which arms in place. The Prompter XL's readouts moved to
// the footer's key; the reason its window does not show stays here, on screen.
//
// The visual overhaul's polish (2026-10-05): the scripts are rows on
// hairlines, not wells; while the Prompter XL draws nothing, no green says the
// script is on it (the plate's status reads NOT ON THE GLASS, the row's lamp is
// hollow); the title plate's line breaks only between its parts; an empty list
// is the design system's empty line.

/** The scripts the list has room for; more are paged, never scrolled (system §10). */
const SCRIPT_ROOM = 10;

export interface TeleprompterPlateProps {
  snapshot: PrompterSnapshot;
  scripts: readonly PrompterScriptSummary[];
  removed: readonly PrompterScriptSummary[];
  selected: PrompterScriptSummary | null;
  armed: ArmedKey | null;
  arm: UseArmResult;
  /** The state display offers Update itself (`NOT UPDATED`): the plate does not repeat it. */
  updateInDisplay: boolean;
  store: ShellStore;
  perform: PerformAction;
  /** Selects a script; false when the editor's text could not be saved and the selection stayed. */
  onSelect: (scriptId: string) => Promise<boolean>;
  /** The plate's key for the selected script: Put on, or Replace's two presses. */
  onPutOn: () => void;
  onUpdate: () => void;
  /** A menu's Put on, one press, for its script (selected first). */
  onPutOnScript: (scriptId: string) => void;
  /** A menu's Replace: selects its script and arms the plate's Replace key. */
  onReplaceElsewhere: (scriptId: string) => void;
  /** Opens a script in the bay's editor (selected first). */
  onEdit: (scriptId: string) => void;
}

/**
 * The selected script's versions, read when it is selected and again when it
 * changes, and whenever `again` moves (Put on, Replace and Update keep a
 * version without changing the script's text; the versions' popover opening).
 * The last read stands while the next is read, so the list never empties under
 * the operator's hand (a Bring back reads again).
 */
function useScriptVersions(store: ShellStore, selected: PrompterScriptSummary | null, again: string) {
  const [read, setRead] = useState<{ scriptId: string; script: PrompterScriptSnapshot } | null>(null);
  const scriptId = selected?.id ?? null;
  const key = selected ? `${selected.id}@${selected.changedAt}#${again}` : null;
  useEffect(() => {
    if (!key || !scriptId) return undefined;
    let current = true;
    store.readPrompterScript(scriptId).then(
      (script) => {
        if (current) setRead({ scriptId, script });
      },
      (error: unknown) => store.reportBackgroundFailure(error, "a script's earlier versions")
    );
    return () => {
      current = false;
    };
  }, [key, scriptId, store]);
  return read && read.scriptId === scriptId ? read.script.versions : null;
}

interface ScriptRowProps {
  script: PrompterScriptSummary;
  selected: boolean;
  /** The Prompter XL draws the text: the script on the prompter is on the glass too. */
  draws: boolean;
  menu: ReturnType<typeof buildScriptMenu>;
  arm: UseArmResult;
  onSelect: () => void;
  /** Keeps the row's ⋯, so a popover its menu opens gives the focus back to it. */
  keyRef: (element: HTMLSpanElement | null) => void;
}

/**
 * A script's row: the row selects it, and its ⋯ stands inside the row's
 * edge, beside it, since a key cannot hold a key. A right-click anywhere on
 * the row opens the same menu. The script on the prompter says so; its lamp is
 * green only while the Prompter XL draws it, hollow while nothing is drawn.
 */
function ScriptRow({ script, selected, draws, menu, arm, onSelect, keyRef }: ScriptRowProps) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <div ref={row} className={styles.row}>
      <button
        type="button"
        className={styles.scriptRow}
        data-selected={selected ? "" : undefined}
        aria-pressed={selected}
        data-testid={`teleprompter-script-${script.id}`}
        onClick={onSelect}
      >
        <span className={styles.scriptText}>
          <b>{script.name}</b>
          <span>{scriptLine(script)}</span>
        </span>
        {script.onPrompter ? <LampWord tone={draws ? "ok" : "off"}>On prompter</LampWord> : null}
      </button>
      <span ref={keyRef} className={styles.rowMenu}>
        <MenuButton
          buttonLabel={`${script.name} menu`}
          buttonTestId={`teleprompter-row-menu-${script.id}`}
          contextTarget={row}
          size="sm"
          menu={{ ...menu, arm }}
        />
      </span>
    </div>
  );
}

interface RemovedRowProps {
  script: PrompterScriptSummary;
  menu: ReturnType<typeof buildRemovedMenu>;
  arm: UseArmResult;
}

/** A removed script's row: its name and length, and its ⋯ (Restore, Delete for good). */
function RemovedRow({ script, menu, arm }: RemovedRowProps) {
  const row = useRef<HTMLLIElement>(null);
  return (
    <li ref={row} className={styles.removedRow} data-testid={`teleprompter-removed-${script.id}`}>
      <span className={styles.scriptText}>
        <b>{script.name}</b>
        <span>{scriptLine(script)}</span>
      </span>
      <MenuButton
        buttonLabel={`${script.name} menu`}
        buttonTestId={`teleprompter-removed-menu-${script.id}`}
        contextTarget={row}
        size="sm"
        menu={{ ...menu, arm }}
      />
    </li>
  );
}

/**
 * The title plate's line under the script's name. Each fact keeps to one line
 * with the `·` after it, so the line breaks only between them (never "4:09 at"
 * over "140"); the file name may break within itself, or a long one would run
 * past the plate, but never before its `·`. Its words are `scriptDetail`'s.
 */
function ScriptDetail({ script }: { script: PrompterScriptSummary }) {
  const { from, facts } = scriptDetailParts(script);
  return (
    <>
      {from ? <>{from}&nbsp;· </> : null}
      {facts.map((fact, index) => (
        <Fragment key={index}>
          <span className={styles.subPart}>
            {fact}
            {index < facts.length - 1 ? " ·" : null}
          </span>
          {index < facts.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

export function TeleprompterPlate({
  snapshot,
  scripts,
  removed,
  selected,
  armed,
  arm,
  updateInDisplay,
  store,
  perform,
  onSelect,
  onPutOn,
  onUpdate,
  onPutOnScript,
  onReplaceElsewhere,
  onEdit,
}: TeleprompterPlateProps) {
  const glass = snapshot.glass;
  const [showRemoved, setShowRemoved] = useState(false);
  const [page, setPage] = useState(0);
  const [renaming, setRenaming] = useState<PrompterScriptSummary | null>(null);
  // The script whose earlier versions are open, and the how-manyth opening
  // (the popover's key: opened again, it takes the focus again).
  const [versionsFor, setVersionsFor] = useState<{ scriptId: string; opening: number } | null>(null);
  const openings = useRef(0);
  const versions = useScriptVersions(
    store,
    selected,
    `${glass?.scriptId ?? ""}:${glass?.notUpdated ? 1 : 0}:${versionsFor?.opening ?? 0}`
  );
  const onGlass = selected !== null && glass?.scriptId === selected.id;
  // The plate's title (what the versions stand beside), its ⋯, and the ⋯
  // whose menu opened the versions: the focus goes back to that one.
  const head = useRef<HTMLDivElement | null>(null);
  const plateKey = useRef<HTMLSpanElement | null>(null);
  const rowKeys = useRef(new Map<string, HTMLSpanElement>());
  const versionsOpener = useRef<HTMLElement | null>(null);
  // The versions are the script's they were opened for: once the selection
  // moves, they close.
  const versionsShown = versionsFor !== null && versionsFor.scriptId === selected?.id ? versionsFor : null;
  useEffect(() => {
    if (versionsFor && versionsFor.scriptId !== selected?.id) setVersionsFor(null);
  }, [selected?.id, versionsFor]);

  const list = showRemoved ? removed : scripts;
  const pages = Math.max(Math.ceil(list.length / SCRIPT_ROOM), 1);
  const shownPage = Math.min(page, pages - 1);
  const rows = list.slice(shownPage * SCRIPT_ROOM, (shownPage + 1) * SCRIPT_ROOM);

  const onPrompterOf = (script: PrompterScriptSummary): OnPrompter =>
    !glass ? "nothing" : glass.scriptId === script.id ? "this" : "another";

  /** Opens a script's earlier versions beside the title, from the ⋯ in `opener`. */
  const openVersions = (scriptId: string, opener: HTMLElement | null) => {
    versionsOpener.current = opener?.querySelector<HTMLElement>("button") ?? opener;
    openings.current += 1;
    setVersionsFor({ scriptId, opening: openings.current });
  };

  /** A script's one menu, for its row's ⋯ and right-click, and for the plate title's ⋯. */
  const scriptMenu = (script: PrompterScriptSummary, onPlate: boolean) =>
    buildScriptMenu({
      script,
      selected: script.id === selected?.id,
      onPrompter: onPrompterOf(script),
      onPlate,
      versions: script.id === selected?.id && versions ? versions.length : null,
      onSelect: () => void onSelect(script.id),
      onPutOn: () => onPutOnScript(script.id),
      onReplace: () => onReplaceElsewhere(script.id),
      onEdit: () => onEdit(script.id),
      onRename: () => setRenaming(script),
      // Another script's versions open once it is selected, and not when the
      // editor's text could not be saved and the selection stayed.
      onVersions: () => {
        const opener = onPlate ? plateKey.current : (rowKeys.current.get(script.id) ?? null);
        if (script.id === selected?.id) {
          openVersions(script.id, opener);
          return;
        }
        void onSelect(script.id).then((selectedNow) => {
          if (selectedNow) openVersions(script.id, opener);
        });
      },
      onRemove: () => void perform(() => store.removePrompterScript(script.id), false),
      testIdPrefix: onPlate ? "teleprompter" : `teleprompter-row-menu-${script.id}`,
    });

  const replaceArmed = selected !== null && armed?.key === teleprompterArmKey.replace(selected.id);
  const updateArmed = armed?.key === UPDATE_ARM_KEY;
  // The one key under the title: Put on the prompter while it is blank,
  // Replace while another script is on it, and for the script on it, Update
  // while it is not updated and the state display does not offer it itself.
  const status = !selected ? null : onGlass ? (
    glass?.notUpdated && !updateInDisplay ? (
      <ArmKey
        armed={updateArmed}
        timeoutMs={armed?.timeoutMs ?? ARM_TIMEOUT_MS}
        countdownTestId="teleprompter-plate-update-countdown"
        take
        className={styles.armRow}
        testId="teleprompter-update"
        onClick={onUpdate}
      >
        {updateArmed ? "Update the prompter" : "Update the prompter · press twice"}
      </ArmKey>
    ) : (
      <Readouts
        className={styles.onPrompter}
        rows={[
          {
            id: "prompter",
            label: "The prompter",
            // The bay's own words while the Prompter XL draws nothing: no green
            // then (the visual overhaul's polish, 2026-10-05).
            value: !snapshot.screen.draws ? (
              <LampWord tone="error">Not on the glass</LampWord>
            ) : glass?.notUpdated ? (
              <LampWord tone="attention">Not updated</LampWord>
            ) : (
              <LampWord tone="ok">On prompter</LampWord>
            ),
          },
        ]}
        data-testid="teleprompter-on-prompter"
      />
    )
  ) : glass ? (
    <ArmKey
      armed={replaceArmed}
      timeoutMs={armed?.timeoutMs ?? ARM_TIMEOUT_MS}
      countdownTestId="teleprompter-replace-countdown"
      take
      className={styles.armRow}
      testId="teleprompter-replace"
      onClick={onPutOn}
    >
      {replaceArmed ? "Replace on the prompter" : "Replace on the prompter · press twice"}
    </ArmKey>
  ) : (
    <Key mode="primary" take testId="teleprompter-put-on" onClick={onPutOn}>
      Put on the prompter
    </Key>
  );

  const windowError = snapshot.screen.windowError;

  return (
    <div className={styles.plate} data-testid="teleprompter-plate">
      {/* A right-click on the title opens the selected script's menu, as its ⋯ does. */}
      <div ref={head}>
        {selected ? (
          <PlateHead
            title={selected.name}
            sub={<ScriptDetail script={selected} />}
            action={
              <span ref={plateKey} className={styles.plateKey}>
                <MenuButton
                  buttonLabel={`${selected.name} menu`}
                  buttonTestId="teleprompter-plate-menu"
                  contextTarget={head}
                  menu={{ ...scriptMenu(selected, true), arm }}
                />
              </span>
            }
            testId="teleprompter-selected"
          />
        ) : (
          <PlateHead
            title={
              <Tooltip
                content="Open a script's file, paste one, or make a new script: the Teleprompter menu on the state display has all three."
                placement="left"
              >
                <span>No scripts</span>
              </Tooltip>
            }
            testId="teleprompter-selected"
          />
        )}
      </div>

      {status ? <div className={styles.status}>{status}</div> : null}

      <Section
        title={
          <Tooltip
            content={
              showRemoved
                ? "The most recently removed first. Restore brings a script back; Delete for good cannot be undone."
                : "Sorted by name: number the scripts to put them in order."
            }
            placement="left"
          >
            <span>{showRemoved ? "Removed" : "Scripts"}</span>
          </Tooltip>
        }
        detail={String(list.length)}
        actions={
          <MenuButton
            buttonLabel="Scripts menu"
            buttonTestId="teleprompter-scripts-menu"
            size="sm"
            menu={{
              ...buildScriptsViewMenu({
                showRemoved,
                scripts: scripts.length,
                removed: removed.length,
                onShow: (next) => {
                  setShowRemoved(next);
                  setPage(0);
                },
              }),
              arm,
            }}
          />
        }
        className={styles.scripts}
        testId="teleprompter-scripts"
      >
        {rows.length === 0 ? (
          <EmptyLine>{showRemoved ? "Nothing is removed" : "No scripts yet"}</EmptyLine>
        ) : showRemoved ? (
          <ul className={styles.scriptList}>
            {rows.map((script) => (
              <RemovedRow
                key={script.id}
                script={script}
                arm={arm}
                menu={buildRemovedMenu({
                  script,
                  onRestore: () => void perform(() => store.restorePrompterScript(script.id)),
                  onDelete: () => void perform(() => store.deletePrompterScript(script.id)),
                })}
              />
            ))}
          </ul>
        ) : (
          <ul className={styles.scriptList}>
            {rows.map((script) => (
              <li key={script.id}>
                <ScriptRow
                  script={script}
                  selected={script.id === selected?.id}
                  draws={snapshot.screen.draws}
                  menu={scriptMenu(script, false)}
                  arm={arm}
                  onSelect={() => void onSelect(script.id)}
                  keyRef={(element) => {
                    if (element) rowKeys.current.set(script.id, element);
                    else rowKeys.current.delete(script.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <div className={styles.pager}>
            <Key
              size="small"
              locked={shownPage === 0}
              reason="This is the first page of the list."
              testId="teleprompter-scripts-earlier"
              onClick={() => setPage(shownPage - 1)}
            >
              ◂ Earlier
            </Key>
            <span>
              {shownPage + 1} of {pages}
            </span>
            <Key
              size="small"
              locked={shownPage === pages - 1}
              reason="This is the last page of the list."
              testId="teleprompter-scripts-later"
              onClick={() => setPage(shownPage + 1)}
            >
              Later ▸
            </Key>
          </div>
        ) : null}
      </Section>

      <TeleprompterLook snapshot={snapshot} store={store} perform={perform} />

      {/* Why the Prompter XL's window does not show, in the shell's words (up
          to 300 characters): a lock's reason, so it stays on screen while it
          stands. The state display's sentence takes its two lines. */}
      {windowError ? (
        <Section title="Not showing" className={styles.windowSection} testId="teleprompter-window">
          <p className={styles.windowError} data-testid="teleprompter-window-error">
            {windowError}
          </p>
        </Section>
      ) : null}

      {selected && versionsShown ? (
        <TeleprompterVersions
          key={versionsShown.opening}
          script={selected}
          versions={versions}
          anchor={head.current}
          opener={versionsOpener}
          onBringBack={(versionId) => void perform(() => store.bringBackPrompterVersion(selected.id, versionId), true)}
          onClose={() => setVersionsFor(null)}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          title="Rename the script"
          initialValue={renaming.name}
          fieldLabel="The script's name"
          maxLength={SCRIPT_NAME_MAX_CHARS}
          confirmLabel="Rename"
          onCancel={() => setRenaming(null)}
          onConfirm={(name) => {
            const script = renaming;
            setRenaming(null);
            if (name !== script.name) void perform(() => store.renamePrompterScript(script.id, name));
          }}
        />
      ) : null}
    </div>
  );
}
