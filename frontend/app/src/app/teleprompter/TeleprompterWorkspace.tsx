import { useEffect, useMemo, useState } from "react";

import { ShellRegion, useArm } from "@sse/design-system";
import type {
  JsonObject,
  JsonValue,
  PrompterGlassSnapshot,
  PrompterHealthCheck,
  PrompterSnapshot,
  ShellStore,
} from "@sse/engine-client";

import { useToast } from "../shared/toastContext";
import { useLiveCallback } from "../shared/useLiveCallback";
import { usePrompterTimeLeft } from "./prompterTime";
import { TeleprompterBay } from "./TeleprompterBay";
import { TeleprompterCluster } from "./TeleprompterCluster";
import { TeleprompterFooter } from "./TeleprompterFooter";
import { TeleprompterPlate } from "./TeleprompterPlate";
import { cutGlassText, glassTextOf, prompterStateView } from "./teleprompterModel";
import styles from "./TeleprompterWorkspace.module.css";

// The Teleprompter page (new pages program, Slice 6a; board 1, "Live mirror",
// `docs/redesign/assets/concepts/A-teleprompter-1.html`, and the proposal,
// `docs/redesign/teleprompter-2026-09.md`). The cluster runs the take, the bay
// shows the page's copy of the glass with the whole script under it, and the
// plate holds the scripts and the look. Everything it shows is the hardware
// link's (`teleprompterModel.ts`); it holds only what the operator is looking
// at: the selected script, the plate's lists and the one armed key.
//
// Replace, Update and Clear are armed (D11, the proposal §10); everything else
// is one press. A refusal comes back as the hardware link's sentence, shown as
// a notice. The editor, New script and Paste as a new script are Slice 6b's.

export interface TeleprompterWorkspaceProps {
  healthSnapshot: JsonObject | null;
  prompterSnapshot: PrompterSnapshot | null;
  prompterGlassSnapshot: PrompterGlassSnapshot | null;
  store: ShellStore;
}

/** What an action answers: the hardware link's sentence, when it gives one. */
function sentenceOf(result: JsonValue): string | null {
  return result && typeof result === "object" && !Array.isArray(result) && typeof result.sentence === "string"
    ? result.sentence
    : null;
}

/** `checks.prompter` from the health snapshot; `null` while it is absent or could not be read. */
function prompterCheckOf(healthSnapshot: JsonObject | null): PrompterHealthCheck | null {
  const checks = healthSnapshot?.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return null;
  const check = (checks as JsonObject).prompter;
  return check && typeof check === "object" && !Array.isArray(check) ? (check as unknown as PrompterHealthCheck) : null;
}

export function TeleprompterWorkspace({
  healthSnapshot,
  prompterSnapshot,
  prompterGlassSnapshot,
  store,
}: TeleprompterWorkspaceProps) {
  const toast = useToast();
  const arm = useArm();
  const [chosenId, setChosenId] = useState<string | null>(null);

  const glass = prompterSnapshot?.glass ?? null;
  const scripts = useMemo(() => prompterSnapshot?.scripts ?? [], [prompterSnapshot]);
  const removed = useMemo(() => prompterSnapshot?.removed ?? [], [prompterSnapshot]);
  // The selected script: the operator's choice while it is in the list, else
  // the one on the prompter, else the first.
  const selected =
    scripts.find((script) => script.id === chosenId) ??
    scripts.find((script) => script.id === glass?.scriptId) ??
    scripts[0] ??
    null;

  const glassText = useMemo(
    () => glassTextOf(prompterSnapshot, prompterGlassSnapshot),
    [prompterSnapshot, prompterGlassSnapshot]
  );
  const cut = useMemo(() => cutGlassText(prompterGlassSnapshot), [prompterGlassSnapshot]);
  const check = useMemo(() => prompterCheckOf(healthSnapshot), [healthSnapshot]);
  const state = useMemo(
    () => (prompterSnapshot ? prompterStateView(prompterSnapshot, check, scripts.length > 0) : null),
    [check, prompterSnapshot, scripts.length]
  );
  const timeLeft = usePrompterTimeLeft(glass);

  // While the text scrolls the hardware link moves the place about once a
  // second and says nothing (it saves it; a take has no event a second), so
  // the page reads the prompter's state once a second to follow it: the place,
  // the paragraph at the reading line, the time left.
  const playing = glass?.playing ?? false;
  useEffect(() => {
    if (!playing) return undefined;
    const id = window.setInterval(() => {
      store
        .refreshPrompterSnapshot()
        .catch((error: unknown) => store.reportBackgroundFailure(error, "the prompter's place"));
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, store]);

  /** Sends one request; a refusal or a failure is the hardware link's sentence, as a notice. */
  const perform = useLiveCallback(async (action: () => Promise<JsonValue>, announce = false) => {
    try {
      const result = await action();
      const sentence = announce ? sentenceOf(result) : null;
      if (sentence) toast.push({ tone: "ok", message: sentence });
      return result;
    } catch (error) {
      toast.push({ tone: "attention", message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });

  const putOn = useLiveCallback(() => {
    if (!selected) return;
    if (!glass) {
      void perform(() => store.putOnPrompter(selected.id), true);
      return;
    }
    arm.armOrApply(
      `replace:${selected.id}`,
      `Replace with ${selected.name}`,
      () => void perform(() => store.putOnPrompter(selected.id, true), true)
    );
  });
  const update = useLiveCallback(() => {
    if (!glass) return;
    arm.armOrApply("update", `Update ${glass.name}`, () => void perform(() => store.updatePrompter(), true));
  });
  const clear = useLiveCallback(() => {
    if (!glass) return;
    arm.armOrApply("clear", "Clear the prompter", () => void perform(() => store.clearPrompter(), true));
  });

  if (!prompterSnapshot || !state) {
    return <div className={styles.waiting} data-testid="teleprompter-workspace" data-workspace="teleprompter" />;
  }

  return (
    <div className={styles.workspace} data-testid="teleprompter-workspace" data-workspace="teleprompter">
      <ShellRegion region="cluster">
        <TeleprompterCluster
          armed={arm.armed}
          cut={cut}
          onClear={clear}
          onUpdate={update}
          onPutOn={putOn}
          perform={perform}
          selected={selected}
          snapshot={prompterSnapshot}
          state={state}
          store={store}
        />
      </ShellRegion>
      <TeleprompterBay
        cut={cut}
        glassText={glassText}
        perform={perform}
        snapshot={prompterSnapshot}
        store={store}
        timeLeft={timeLeft}
      />
      <ShellRegion region="plate">
        <TeleprompterPlate
          armed={arm.armed}
          onPutOn={putOn}
          onSelect={setChosenId}
          onUpdate={update}
          perform={perform}
          removed={removed}
          scripts={scripts}
          selected={selected}
          snapshot={prompterSnapshot}
          store={store}
        />
      </ShellRegion>
      <ShellRegion region="footer">
        <TeleprompterFooter cut={cut} snapshot={prompterSnapshot} timeLeft={timeLeft} />
      </ShellRegion>
    </div>
  );
}

export type PerformAction = (action: () => Promise<JsonValue>, announce?: boolean) => Promise<JsonValue | null>;
