import { SetupStepScreen, SetupFactCard, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import { formatBackupTimestamp, healthCheckTone } from "../../shellData";
import { Key } from "@sse/design-system";
import { runnerStepOrder } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 5: publish the setup, which unlocks the pages and exports a backup. */
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
  const overriding = notPassedProbes.length > 0;
  return (
    <>
      {activeStepId === "publish" ? (
        <SetupStepScreen
          head={bayHead}
          eyebrow={`Step ${runnerStepOrder.length} of ${runnerStepOrder.length}`}
          title="Publish"
          lead="Publishing unlocks Lighting, Audio, Cameras and Teleprompter, exports a backup and opens the Console. Once published, the deck's pages, the bridge and the desk are live for the next session."
          rules={[
            {
              id: "probes",
              text: overriding
                ? `${notPassedProbes.length} of ${setupState.probeCount} probes have not passed: publishing asks first, and records the override with the time.`
                : "Every probe passed.",
              tone: overriding ? "attention" : "ok",
            },
          ]}
          facts={
            <>
              <SetupFactCard
                label="Latest backup"
                value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "None yet"}
                tone={lastBackup ? "ok" : "attention"}
              />
              <SetupFactCard
                label="Opens at start"
                value={String(startup?.targetSurface ?? "commissioning") === "dashboard" ? "Console" : "Setup"}
                tone={isReady ? "ok" : "attention"}
              />
            </>
          }
          actions={
            <>
              <Key
                mode={overriding ? "danger" : "primary"}
                size="large"
                disabled={busyAction !== null}
                testId="setup-step-primary"
                onClick={() => invokePrimaryAction()}
              >
                {busyAction
                  ? "Working…"
                  : overriding
                    ? "Publish with override…"
                    : isReady
                      ? "Open the Console"
                      : "Publish setup"}
              </Key>
              {backKey}
            </>
          }
          // What the press changes, while it changes something.
          note={!isReady && !overriding ? "Publish exports a backup, then opens the Console." : undefined}
          record={
            <>
              {/* What publish commits, as the hardware link holds it: the
                  addresses and the counts, not a repeat of the probe
                  sentences the cluster already prints. */}
              <SetupRecordHeading>What publish records</SetupRecordHeading>
              <SetupRecordRow
                label="Hardware profile"
                value={String(commissioningSnapshot?.hardwareProfile ?? "not reported")}
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
                tone={healthCheckTone(controlSurface?.status) === "ok" ? "ok" : "attention"}
              />
              <SetupRecordRow
                label="Override"
                value={publishOverrideRecorded ?? "none recorded"}
                tone={publishOverrideRecorded ? "attention" : "off"}
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
              <SetupRecordHeading>Backups</SetupRecordHeading>
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
                <SetupRecordRow label="None yet" value="Publish exports one" tone="attention" />
              )}
            </>
          }
          testId="setup-screen-publish"
        />
      ) : null}
    </>
  );
}
