import { useEffect, useState } from "react";

import {
  ArmKey,
  ARM_TIMEOUT_MS,
  ConfirmDialog,
  Key,
  LampWord,
  PlateHead,
  Readouts,
  Section,
  type ArmedKey,
} from "@sse/design-system";
import type {
  PrompterScriptSnapshot,
  PrompterScriptSummary,
  PrompterSnapshot,
  PrompterVersionSummary,
  ShellStore,
} from "@sse/engine-client";

import { TeleprompterLook } from "./TeleprompterLook";
import { clockTime, scriptDetail, scriptLine } from "./teleprompterModel";
import type { PerformAction } from "./TeleprompterWorkspace";
import styles from "./TeleprompterPlate.module.css";

// The Teleprompter's plate (new pages program, Slice 6a; board 1's right
// column, the proposal §2, §3.3 and §5.5): the selected script — Put on the
// prompter, or Replace or Update · press twice (D11), its earlier versions and
// Remove — the scripts sorted by name with Removed beside them, the look, and
// the Prompter XL as Windows reports it. Rename and the editor are Slice 6b's.

/** The scripts the list has room for; more are paged, never scrolled (system §10). */
const SCRIPT_ROOM = 8;

/** The scripts it has room for while the earlier versions are open above it. */
const SCRIPT_ROOM_BESIDE_VERSIONS = 5;

/** The earlier versions shown at once, newest first; the hardware link keeps 20, paged. */
const VERSION_ROOM = 4;

/** Why a version was kept, as the plate says it (`PrompterVersionSummary.reason`). */
const VERSION_WORDS: Record<string, string> = {
  imported: "imported",
  pasted: "pasted",
  "put-on": "put on",
  replaced: "put on",
  updated: "updated",
  "before-file-update": "before a new file",
  "before-bringing-back": "before a bring back",
  "from-backup": "from a backup",
};

export interface TeleprompterPlateProps {
  snapshot: PrompterSnapshot;
  scripts: readonly PrompterScriptSummary[];
  removed: readonly PrompterScriptSummary[];
  selected: PrompterScriptSummary | null;
  armed: ArmedKey | null;
  store: ShellStore;
  perform: PerformAction;
  onSelect: (scriptId: string) => void;
  onPutOn: () => void;
  onUpdate: () => void;
}

/** The selected script's versions, read when it is selected and again when it changes. */
function useScriptVersions(store: ShellStore, selected: PrompterScriptSummary | null) {
  const [read, setRead] = useState<{ key: string; script: PrompterScriptSnapshot } | null>(null);
  const key = selected ? `${selected.id}@${selected.changedAt}` : null;
  const scriptId = selected?.id ?? null;
  useEffect(() => {
    if (!key || !scriptId) return undefined;
    let current = true;
    store.readPrompterScript(scriptId).then(
      (script) => {
        if (current) setRead({ key, script });
      },
      (error: unknown) => store.reportBackgroundFailure(error, "a script's earlier versions")
    );
    return () => {
      current = false;
    };
  }, [key, scriptId, store]);
  return read && read.key === key ? read.script.versions : null;
}

function versionLine(version: PrompterVersionSummary): string {
  const when = clockTime(version.keptAt);
  const why = VERSION_WORDS[version.reason] ?? "kept";
  return `${why}${when ? ` ${when}` : ""} · ${version.readWords.toLocaleString("en-GB")} words`;
}

export function TeleprompterPlate({
  snapshot,
  scripts,
  removed,
  selected,
  armed,
  store,
  perform,
  onSelect,
  onPutOn,
  onUpdate,
}: TeleprompterPlateProps) {
  const glass = snapshot.glass;
  const [showRemoved, setShowRemoved] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [page, setPage] = useState(0);
  // The versions' page belongs to the script it was turned for.
  const [versionPage, setVersionPage] = useState<{ scriptId: string | null; page: number }>({
    scriptId: null,
    page: 0,
  });
  const [deleting, setDeleting] = useState<PrompterScriptSummary | null>(null);
  const versions = useScriptVersions(store, selected);
  const onGlass = selected !== null && glass?.scriptId === selected.id;

  const list = showRemoved ? removed : scripts;
  const room = showVersions && selected ? SCRIPT_ROOM_BESIDE_VERSIONS : SCRIPT_ROOM;
  const pages = Math.max(Math.ceil(list.length / room), 1);
  const shownPage = Math.min(page, pages - 1);
  const rows = list.slice(shownPage * room, (shownPage + 1) * room);
  const versionPages = Math.max(Math.ceil((versions?.length ?? 0) / VERSION_ROOM), 1);
  const shownVersionPage =
    versionPage.scriptId === (selected?.id ?? null) ? Math.min(versionPage.page, versionPages - 1) : 0;
  const turnVersions = (to: number) => setVersionPage({ scriptId: selected?.id ?? null, page: to });

  const status = !selected ? null : onGlass ? (
    glass?.notUpdated ? (
      <ArmKey
        armed={armed?.key === "update"}
        timeoutMs={ARM_TIMEOUT_MS}
        countdownTestId="teleprompter-plate-update-countdown"
        hint="press twice"
        testId="teleprompter-update"
        onClick={onUpdate}
      >
        Update the prompter
      </ArmKey>
    ) : (
      <div className={styles.onPrompter} data-testid="teleprompter-on-prompter">
        <LampWord tone="ok">On prompter</LampWord>
        <span>Remove waits until the prompter is cleared.</span>
      </div>
    )
  ) : glass ? (
    <ArmKey
      armed={armed?.key === `replace:${selected.id}`}
      timeoutMs={ARM_TIMEOUT_MS}
      countdownTestId="teleprompter-replace-countdown"
      hint="press twice"
      testId="teleprompter-replace"
      onClick={onPutOn}
    >
      Replace on the prompter
    </ArmKey>
  ) : (
    <Key mode="primary" testId="teleprompter-put-on" onClick={onPutOn}>
      Put on the prompter
    </Key>
  );

  return (
    <div className={styles.plate} data-testid="teleprompter-plate">
      {selected ? (
        <PlateHead title={selected.name} sub={scriptDetail(selected)} testId="teleprompter-selected" />
      ) : (
        <PlateHead title="No scripts" sub="Open a script's file to add it here." testId="teleprompter-selected" />
      )}

      {selected ? (
        <div className={styles.selectedKeys}>
          {status}
          <div className={styles.pair}>
            <Key
              size="small"
              engaged={showVersions}
              testId="teleprompter-versions"
              onClick={() => setShowVersions((open) => !open)}
            >
              Earlier versions{versions ? ` · ${versions.length}` : ""}
            </Key>
            <Key
              size="small"
              locked={onGlass}
              reason={`${selected.name} is on the prompter. Clear the prompter first.`}
              testId="teleprompter-remove"
              onClick={() => void perform(() => store.removePrompterScript(selected.id), false)}
            >
              Remove
            </Key>
          </div>
          {showVersions ? (
            <>
              <ol className={styles.versions} data-well="" data-testid="teleprompter-version-list">
                {versions && versions.length === 0 ? <li className={styles.none}>No earlier versions.</li> : null}
                {(versions ?? [])
                  .slice(shownVersionPage * VERSION_ROOM, (shownVersionPage + 1) * VERSION_ROOM)
                  .map((version) => (
                    <li key={version.id} className={styles.version}>
                      <span>{versionLine(version)}</span>
                      <Key
                        size="small"
                        testId={`teleprompter-bring-back-${version.id}`}
                        onClick={() =>
                          void perform(() => store.bringBackPrompterVersion(selected.id, version.id), true)
                        }
                      >
                        Bring back
                      </Key>
                    </li>
                  ))}
              </ol>
              {versionPages > 1 ? (
                <div className={styles.pager}>
                  <Key
                    size="small"
                    locked={shownVersionPage === 0}
                    reason="These are the newest versions."
                    testId="teleprompter-versions-newer"
                    onClick={() => turnVersions(shownVersionPage - 1)}
                  >
                    ◂ Newer
                  </Key>
                  <span>
                    {shownVersionPage + 1} of {versionPages}
                  </span>
                  <Key
                    size="small"
                    locked={shownVersionPage === versionPages - 1}
                    reason="These are the oldest versions kept."
                    testId="teleprompter-versions-older"
                    onClick={() => turnVersions(shownVersionPage + 1)}
                  >
                    Older ▸
                  </Key>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <Section
        title={showRemoved ? "Removed" : "Scripts"}
        detail={
          showRemoved ? `${removed.length} · the most recently removed first` : `${scripts.length} · sorted by name`
        }
        actions={
          <Key
            size="small"
            engaged={showRemoved}
            testId="teleprompter-removed"
            onClick={() => {
              setShowRemoved((open) => !open);
              setPage(0);
            }}
          >
            {showRemoved ? "Scripts" : `Removed · ${removed.length}`}
          </Key>
        }
        className={styles.scripts}
        testId="teleprompter-scripts"
      >
        <ul className={styles.scriptList}>
          {rows.length === 0 ? (
            <li className={styles.none}>{showRemoved ? "Nothing is removed." : "No scripts yet."}</li>
          ) : null}
          {rows.map((script) =>
            showRemoved ? (
              <li
                key={script.id}
                className={styles.removedRow}
                data-well=""
                data-testid={`teleprompter-removed-${script.id}`}
              >
                <span className={styles.scriptText}>
                  <b>{script.name}</b>
                  <span>{scriptLine(script)}</span>
                </span>
                <Key
                  size="small"
                  testId={`teleprompter-restore-${script.id}`}
                  onClick={() => void perform(() => store.restorePrompterScript(script.id))}
                >
                  Restore
                </Key>
                <Key
                  size="small"
                  mode="danger"
                  testId={`teleprompter-delete-${script.id}`}
                  onClick={() => setDeleting(script)}
                >
                  Delete for good…
                </Key>
              </li>
            ) : (
              <li key={script.id}>
                <button
                  type="button"
                  className={styles.scriptRow}
                  data-well=""
                  data-selected={script.id === selected?.id ? "" : undefined}
                  aria-pressed={script.id === selected?.id}
                  data-testid={`teleprompter-script-${script.id}`}
                  onClick={() => {
                    onSelect(script.id);
                    setShowVersions(false);
                  }}
                >
                  <span className={styles.scriptText}>
                    <b>{script.name}</b>
                    <span>{scriptLine(script)}</span>
                  </span>
                  {script.onPrompter ? <LampWord tone="ok">On prompter</LampWord> : null}
                </button>
              </li>
            )
          )}
        </ul>
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

      <Section title="The Prompter XL" detail="as Windows reports it" testId="teleprompter-screen">
        <Readouts
          rows={[
            {
              id: "state",
              label: "Link",
              value: snapshot.screen.word.toLowerCase(),
              tone: snapshot.screen.tone === "ok" ? "ok" : snapshot.screen.tone === "attention" ? "attention" : "error",
            },
            {
              id: "resolution",
              label: "Resolution",
              value:
                snapshot.screen.width !== null && snapshot.screen.height !== null
                  ? `${snapshot.screen.width}×${snapshot.screen.height}`
                  : "—",
            },
            {
              id: "refresh",
              label: "Refresh",
              value: snapshot.screen.refreshHz !== null ? `${snapshot.screen.refreshHz} Hz` : "—",
            },
            {
              id: "shows",
              label: "Windows shows it",
              value:
                snapshot.screen.state === "duplicated"
                  ? "a copy of another screen"
                  : snapshot.screen.width !== null
                    ? "extended"
                    : "—",
            },
          ]}
          data-testid="teleprompter-screen-readouts"
        />
        {snapshot.screen.windowError ? (
          <p className={styles.windowError} data-testid="teleprompter-window-error">
            The window did not open: {snapshot.screen.windowError}
          </p>
        ) : null}
      </Section>

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.name} for good?`}
          body="The script and its earlier versions are deleted from Studio Control. This cannot be undone."
          confirmLabel="Delete for good"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const script = deleting;
            setDeleting(null);
            void perform(() => store.deletePrompterScript(script.id));
          }}
        />
      ) : null}
    </div>
  );
}
