import { SetupStepScreen, SetupFactCard, SetupRecordSection, SetupRecordRow } from "../components/SetupStepScreen";
import { formatBackupTimestamp, healthCheckTone } from "../../shellData";
import { Key } from "@sse/design-system";
import { hardwareProfileWord } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 5: publish the setup, which unlocks the pages and exports a backup. */
export function SetupPublishStep({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot } = editor.props;
  const {
    activeStepId,
    lastBackup,
    startup,
    isReady,
    busyAction,
    lightingBridgeIp,
    lightingUniverse,
    audioSendHost,
    audioSendPort,
    audioReceivePort,
    pages,
    totalControlCount,
    controlSurface,
  } = editor.state;
  const { stepEyebrow, notPassedProbes, backKey, setupState, publishOverrideRecorded } = editor.chrome;
  const { invokePrimaryAction } = editor.actions;
  const overriding = notPassedProbes.length > 0;
  // The deck's bridge: its address, and its standing only when it is not ok.
  const bridge = healthCheckTone(controlSurface?.status);
  return (
    <>
      {activeStepId === "publish" ? (
        <SetupStepScreen
          eyebrow={stepEyebrow}
          title="Publish"
          lead="Publishing unlocks Lighting, Audio, Cameras and Teleprompter, exports a backup and opens the Console. Once published, the deck's pages, the bridge and the desk are live for the next session."
          // The visual overhaul's polish (2026-10-05): a rule only while a
          // press needs it read; "Every probe passed." said again what the
          // state display, the Probes section and the footer say.
          rules={
            overriding
              ? [
                  {
                    id: "probes",
                    text: `${notPassedProbes.length} of ${setupState.probeCount} probes have not passed: publishing asks first, and records the override with the time.`,
                    tone: "attention",
                  },
                ]
              : []
          }
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
            // What publish commits, as the hardware link holds it: the
            // addresses and the counts, not a repeat of the probe sentences
            // the cluster already prints. The visual overhaul's polish
            // (2026-10-05): "The steps above, as done" and the backups went
            // (the cluster's steps print each step's word, the latest backup
            // is the fact beside the keys and the plate's), and a value is
            // coloured only when it stands in doubt or in fault.
            <SetupRecordSection title="What publish records">
              <SetupRecordRow
                label="Hardware profile"
                value={hardwareProfileWord(commissioningSnapshot?.hardwareProfile, "not reported")}
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
              {/* The bridge's own address (its sentence when it reports
                  none); whether the deck's export is current is the
                  cluster's Control surface probe's word. */}
              <SetupRecordRow
                label="Deck's bridge"
                value={String(controlSurface?.baseUrl ?? controlSurface?.summary ?? "not reported")}
                tone={bridge === "ok" || bridge === "error" ? bridge : "attention"}
              />
              <SetupRecordRow
                label="Override"
                value={publishOverrideRecorded ?? "none recorded"}
                tone={publishOverrideRecorded ? "attention" : "off"}
                testId={publishOverrideRecorded ? "setup-publish-override-note" : undefined}
              />
            </SetupRecordSection>
          }
          testId="setup-screen-publish"
        />
      ) : null}
    </>
  );
}
