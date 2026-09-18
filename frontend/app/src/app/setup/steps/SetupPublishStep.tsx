import { SetupStepScreen, SetupFactCard, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import { formatBackupTimestamp, asStatusTone } from "../../shellData";
import { Key } from "@sse/design-system";
import { runnerStepOrder } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 5: publish the setup and export the Stream Deck profile. */
export function SetupPublishStep({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot } = editor.props;
  const {
    activeStepId,
    lastBackup,
    startup,
    isReady,
    backups,
    busyAction,
    lightingBridgeIp,
    lightingUniverse,
    audioSendHost,
    audioSendPort,
    audioReceivePort,
    pages,
    totalControlCount,
    controlSurface,
    echoControlId,
  } = editor.state;
  const { bayHead, notPassedProbes, backKey, setupState, publishOverrideRecorded, clusterSteps } = editor.chrome;
  const { invokePrimaryAction } = editor.actions;
  return (
    <>
      {activeStepId === "publish" ? (
        <SetupStepScreen
          head={bayHead}
          eyebrow={`Step ${runnerStepOrder.length} of ${runnerStepOrder.length}`}
          title="Publish"
          lead="Publishing unlocks the operator workspaces, exports a fresh support backup, and returns you to the console."
          rules={[
            {
              id: "probes",
              text: "The deck, bridge and desk probes must all be green before publish; publishing with a probe that is not green asks for an explicit override and records it.",
              tone: notPassedProbes.length > 0 ? "attention" : "ok",
            },
            {
              id: "backup",
              text: "The support backup export is part of publish, not a chore for afterwards.",
              tone: "ok",
            },
            {
              id: "live",
              text: "Once published, the deck's pages, the bridge and the desk are live for the next session.",
              tone: "ok",
            },
          ]}
          facts={
            <>
              <SetupFactCard
                label="Latest backup"
                value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "None"}
                standing={lastBackup ? "healthy" : "none yet"}
                tone={lastBackup ? "ok" : "attention"}
              />
              <SetupFactCard
                label="Startup target"
                value={
                  String(startup?.targetSurface ?? "commissioning") === "dashboard" ? "Console" : "Setup / Support"
                }
                standing={isReady ? "healthy" : "pending publish"}
                tone={isReady ? "ok" : "attention"}
              />
              <SetupFactCard
                label="Support archives"
                value={`${backups.length} · native`}
                standing={backups.length > 0 ? "ready" : "none yet"}
                tone={backups.length > 0 ? "ok" : "attention"}
              />
            </>
          }
          actions={
            <>
              <Key
                mode={notPassedProbes.length > 0 ? "danger" : "primary"}
                take
                disabled={busyAction !== null}
                testId="setup-step-primary"
                onClick={() => invokePrimaryAction()}
              >
                {busyAction
                  ? "Working…"
                  : notPassedProbes.length > 0
                    ? "Publish with override…"
                    : isReady
                      ? "Open planning"
                      : "Publish setup"}
              </Key>
              {backKey}
            </>
          }
          note={
            notPassedProbes.length > 0
              ? `${notPassedProbes.length} of ${setupState.probeCount} probes are not green. Publishing now asks for an explicit override and records it with a timestamp.`
              : "Writes the gate, exports a backup, then opens the console."
          }
          record={
            <>
              {/* What publish commits, as the engine holds it: the
                          addresses and the counts, not a repeat of the probe
                          sentences the cluster already prints. */}
              <SetupRecordHeading>What publish records</SetupRecordHeading>
              <SetupRecordRow
                label="Hardware profile"
                value={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
              />
              <SetupRecordRow
                label="Lighting bridge"
                value={lightingBridgeIp ? `${lightingBridgeIp} · U${lightingUniverse}` : "no address recorded"}
                tone={lightingBridgeIp ? "ok" : "attention"}
              />
              <SetupRecordRow
                label="TotalMix"
                value={`${audioSendHost}:${audioSendPort} · receive ${audioReceivePort}`}
              />
              <SetupRecordRow
                label="Deck"
                value={`${pages.length} pages · ${totalControlCount} controls`}
                tone={pages.length > 0 ? "ok" : "attention"}
              />
              <SetupRecordRow
                label="Companion profile"
                value={String(controlSurface?.summary ?? "not exported yet")}
                tone={asStatusTone(controlSurface?.status, "info") === "ok" ? "ok" : "attention"}
              />
              <SetupRecordRow
                label="Override"
                value={publishOverrideRecorded ?? "none recorded"}
                tone={publishOverrideRecorded ? "attention" : "ok"}
                testId={publishOverrideRecorded ? "setup-publish-override-note" : undefined}
              />
              <SetupRecordHeading>The steps above, as done</SetupRecordHeading>
              {clusterSteps.slice(0, -1).map((step, index) => (
                <SetupRecordRow
                  key={step.id}
                  label={`${index + 1} · ${step.label}`}
                  value={
                    step.id === "probe"
                      ? `${setupState.passedProbeCount} of ${setupState.probeCount} probes passed`
                      : step.id === "import"
                        ? String(controlSurface?.summary ?? "not exported yet")
                        : step.id === "map"
                          ? `${pages.length} pages · ${totalControlCount} controls mapped`
                          : echoControlId
                            ? "a control echoed"
                            : "not confirmed this session"
                  }
                  tone={step.standing === "done" ? "ok" : step.standing === "failed" ? "error" : "attention"}
                />
              ))}
              <SetupRecordHeading>Support archives</SetupRecordHeading>
              {backups.length > 0 ? (
                backups
                  .slice(0, 3)
                  .map((backup) => (
                    <SetupRecordRow
                      key={backup.path}
                      label={backup.name}
                      value={formatBackupTimestamp(backup.modifiedAt)}
                    />
                  ))
              ) : (
                <SetupRecordRow label="No archives yet" value="export one with publish" tone="attention" />
              )}
            </>
          }
          testId="setup-screen-publish"
        />
      ) : null}
    </>
  );
}
