import { useMemo, useState, useRef, useEffect } from "react";
import {
  getCommissioningChecks,
  getSupportBackups,
  asRecord,
  asStatusTone,
  type StatusToneLike,
} from "../../shellData";
import { getRecentActions } from "../components/RecentActions";
import { useOperatorLayout } from "../../OperatorLayoutProvider";
import { parseControlSurfaceLastEvent, findEchoControlId } from "../setupControlEcho";
import {
  parseControlSurfacePages,
  normalizeSetupMode,
  deriveRecommendedStepId,
  type SetupMode,
  type RunnerStepId,
  type ActionFeedback,
  runnerStepOrder,
  type RunnerStep,
  type SetupSupportPilotProps,
} from "../setupPilotModel";

/** What Setup / Support holds: the Stream Deck pages, the probes, the backups,
 *  the recent actions, runner or support mode, the step in view, the forms'
 *  fields, what is busy, the last result, and the runner's steps. */
export function useSetupPilotState({ props }: { props: SetupSupportPilotProps }) {
  const { controlSurfaceSnapshot, commissioningSnapshot, supportSnapshot, appSnapshot, store, healthSnapshot } = props;
  const pages = useMemo(() => parseControlSurfacePages(controlSurfaceSnapshot), [controlSurfaceSnapshot]);
  const checks = useMemo(() => getCommissioningChecks(commissioningSnapshot), [commissioningSnapshot]);
  const backups = useMemo(() => getSupportBackups(supportSnapshot), [supportSnapshot]);
  const recentActions = useMemo(() => getRecentActions(supportSnapshot), [supportSnapshot]);
  const persistedMode = useMemo(() => normalizeSetupMode(appSnapshot), [appSnapshot]);
  const recommendedStepId = useMemo(
    () => deriveRecommendedStepId(commissioningSnapshot, pages),
    [commissioningSnapshot, pages]
  );

  const { setTheme, setUiScale, theme, uiScale } = useOperatorLayout();
  const [mode, setMode] = useState<SetupMode>(persistedMode);
  const [activeStepId, setActiveStepId] = useState<RunnerStepId>(recommendedStepId);
  const [pendingStepId, setPendingStepId] = useState<RunnerStepId | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  // 2026-09 audit Slice 8: probes that are not green when the operator asks
  // to publish; non-null opens the "Publish with failing probes?" confirm.
  const [publishOverridePrompt, setPublishOverridePrompt] = useState<string[] | null>(null);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [echoControlId, setEchoControlId] = useState<string | null>(null);
  const [exportBaseUrl, setExportBaseUrl] = useState("");
  const [lightingBridgeIp, setLightingBridgeIp] = useState("");
  const [lightingUniverse, setLightingUniverse] = useState("1");
  const [audioSendHost, setAudioSendHost] = useState("127.0.0.1");
  const [audioSendPort, setAudioSendPort] = useState("7001");
  const [audioReceivePort, setAudioReceivePort] = useState("9001");
  const [restorePath, setRestorePath] = useState("");
  const lastEchoEventAtRef = useRef<number | null>(null);
  const echoTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setMode(persistedMode);
  }, [persistedMode]);

  useEffect(() => {
    const runtime = asRecord(appSnapshot?.runtime);
    const controlSurface = asRecord(runtime?.controlSurface);
    setExportBaseUrl(String(controlSurface?.baseUrl ?? ""));
    setLightingBridgeIp(String(asRecord(commissioningSnapshot?.lighting)?.bridgeIp ?? ""));
    setLightingUniverse(String(asRecord(commissioningSnapshot?.lighting)?.universe ?? 1));
    setAudioSendHost(String(asRecord(commissioningSnapshot?.audio)?.sendHost ?? "127.0.0.1"));
    setAudioSendPort(String(asRecord(commissioningSnapshot?.audio)?.sendPort ?? 7001));
    setAudioReceivePort(String(asRecord(commissioningSnapshot?.audio)?.receivePort ?? 9001));
  }, [appSnapshot, commissioningSnapshot]);

  useEffect(() => {
    const latestBackup = backups[0];
    if (latestBackup && !restorePath) {
      setRestorePath(latestBackup.path);
    }
  }, [backups, restorePath]);

  useEffect(() => {
    if (!pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(pages[0]?.id ?? "");
      setSelectedControlId(pages[0]?.buttons[0]?.id ?? pages[0]?.dials[0]?.id ?? null);
    }
  }, [pages, selectedPageId]);

  useEffect(() => {
    setActiveStepId(recommendedStepId);
  }, [recommendedStepId]);

  useEffect(() => {
    if (activeStepId !== "verify") {
      lastEchoEventAtRef.current = null;
      return;
    }

    const pollTimer = window.setInterval(() => {
      void store.refreshControlSurfaceSnapshot();
    }, 500);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [activeStepId, store]);

  useEffect(() => {
    if (activeStepId !== "verify") {
      return;
    }

    const lastEvent = parseControlSurfaceLastEvent(controlSurfaceSnapshot?.lastEvent);
    if (!lastEvent) {
      return;
    }
    if (lastEchoEventAtRef.current === null) {
      // The first observed event predates this verify session; only pulse for
      // presses that arrive after the operator opened the step.
      lastEchoEventAtRef.current = lastEvent.at;
      return;
    }
    if (lastEvent.at === lastEchoEventAtRef.current) {
      return;
    }
    lastEchoEventAtRef.current = lastEvent.at;

    const changedControlId = findEchoControlId(pages, lastEvent, selectedPageId || null);
    if (changedControlId) {
      setEchoControlId(changedControlId);
      if (echoTimeoutRef.current !== null) {
        window.clearTimeout(echoTimeoutRef.current);
      }
      echoTimeoutRef.current = window.setTimeout(() => {
        setEchoControlId(null);
        echoTimeoutRef.current = null;
      }, 300);
    }
  }, [activeStepId, controlSurfaceSnapshot, pages, selectedPageId]);

  useEffect(() => {
    return () => {
      if (echoTimeoutRef.current !== null) {
        window.clearTimeout(echoTimeoutRef.current);
      }
    };
  }, []);

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const selectedControl =
    selectedPage?.buttons.find((control) => control.id === selectedControlId) ??
    selectedPage?.dials.find((control) => control.id === selectedControlId) ??
    null;

  const runtime = asRecord(appSnapshot?.runtime);
  const runtimePaths = asRecord(runtime?.paths);
  const controlSurface = asRecord(runtime?.controlSurface);
  const startup = asRecord(appSnapshot?.startup);
  // SET-01: the banner fires on ANY non-ok health tone, so derive its title
  // from that tone instead of the hardcoded alarming "Degraded startup posture"
  // (an `attention` posture is not "degraded").
  const healthTone = healthSnapshot ? asStatusTone(healthSnapshot.status, "info") : "ok";
  const degradedSummary =
    healthTone !== "ok"
      ? String(healthSnapshot?.summary ?? "The desk or the bridge needs attention. Run all probes to see which.")
      : null;
  const isReady = commissioningSnapshot?.hasCompletedSetup === true;
  const lastBackup = backups[0];
  const stepIndex = runnerStepOrder.indexOf(activeStepId);
  const totalControlCount = pages.reduce((count, page) => count + page.buttons.length + page.dials.length, 0);
  const canReturnToConsole = String(startup?.targetSurface ?? "commissioning") === "dashboard";
  const probeHasError = checks.some((check) => check.status === "error");

  const runnerSteps = useMemo<RunnerStep[]>(
    () =>
      runnerStepOrder.map((id, index) => {
        const tone: StatusToneLike =
          id === "probe" && probeHasError
            ? "error"
            : index < stepIndex || (id === "publish" && isReady)
              ? "ok"
              : id === activeStepId
                ? "attention"
                : "info";

        const hintMap: Record<RunnerStepId, string> = {
          import: "Export the ready-to-import Companion profile.",
          probe: "Run the deck, bridge and desk probes.",
          map: "Review the deck's pages, buttons and dials.",
          publish: "Commit commissioning and export a support backup.",
          verify: "Press physical controls and watch for live echo.",
        };

        const labelMap: Record<RunnerStepId, string> = {
          import: "Import profile",
          probe: "Probe hardware",
          map: "Map bindings",
          publish: "Publish",
          verify: "Verify live echo",
        };

        return {
          hint: hintMap[id],
          id,
          label: labelMap[id],
          tone,
        };
      }),
    [activeStepId, isReady, probeHasError, stepIndex]
  );
  return {
    pages,
    checks,
    backups,
    recentActions,
    setTheme,
    setUiScale,
    theme,
    uiScale,
    mode,
    setMode,
    activeStepId,
    setActiveStepId,
    pendingStepId,
    setPendingStepId,
    busyAction,
    setBusyAction,
    feedback,
    setFeedback,
    publishOverridePrompt,
    setPublishOverridePrompt,
    setSelectedPageId,
    selectedControlId,
    setSelectedControlId,
    echoControlId,
    exportBaseUrl,
    setExportBaseUrl,
    lightingBridgeIp,
    setLightingBridgeIp,
    lightingUniverse,
    setLightingUniverse,
    audioSendHost,
    setAudioSendHost,
    audioSendPort,
    setAudioSendPort,
    audioReceivePort,
    setAudioReceivePort,
    restorePath,
    setRestorePath,
    selectedPage,
    selectedControl,
    runtime,
    runtimePaths,
    controlSurface,
    startup,
    healthTone,
    degradedSummary,
    isReady,
    lastBackup,
    stepIndex,
    totalControlCount,
    canReturnToConsole,
    probeHasError,
    runnerSteps,
  };
}

export type SetupPilotState = ReturnType<typeof useSetupPilotState>;
