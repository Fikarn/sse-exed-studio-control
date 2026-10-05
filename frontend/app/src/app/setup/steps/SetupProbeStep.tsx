import { SetupField, SetupStepScreen, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import styles from "../SetupSupportPilot.module.css";
import { formatBackupTimestamp } from "../../shellData";
import { Key } from "@sse/design-system";
import { runnerStepOrder, probeChecks } from "../setupPilotModel";
import { probeTone, probeWord } from "../setupState";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 2: the deck, bridge and desk probes. */
export function SetupProbeStep({ editor }: { editor: SetupPilot }) {
  const {
    activeStepId,
    probeHasError,
    setLightingBridgeIp,
    lightingBridgeIp,
    setLightingUniverse,
    lightingUniverse,
    setAudioSendHost,
    audioSendHost,
    setAudioSendPort,
    audioSendPort,
    setAudioReceivePort,
    audioReceivePort,
    checks,
    busyAction,
  } = editor.state;
  const { bayHead, setupState, primaryKey, backKey } = editor.chrome;
  const { performAction, runSingleProbe } = editor.actions;
  return (
    <>
      {activeStepId === "probe" ? (
        <SetupStepScreen
          head={bayHead}
          eyebrow={`Step 2 of ${runnerStepOrder.length}`}
          title="Probe hardware"
          lead="Run the deck, bridge and desk probes in one pass. What each one answers shows under Probes too. A probe that fails never moves the runner on."
          rules={[
            {
              id: "green",
              text: "Every probe passes before Publish; publishing past one that has not asks first and records it.",
              tone: probeHasError
                ? "error"
                : setupState.passedProbeCount === setupState.probeCount
                  ? "ok"
                  : "attention",
            },
            // What a press changes stays on screen: the lights and the
            // Console follow the addresses the probes saved.
            { id: "saves", text: "Each probe saves the address it asks, whether it passes or not." },
          ]}
          facts={
            <>
              <SetupField
                label="Lighting bridge IP"
                placeholder="192.168.1.80"
                value={lightingBridgeIp}
                onChange={(event) => setLightingBridgeIp(event.target.value)}
              />
              <SetupField
                label="Lighting universe"
                value={lightingUniverse}
                onChange={(event) => setLightingUniverse(event.target.value)}
              />
              <SetupField
                label="TotalMix send host"
                wide
                value={audioSendHost}
                onChange={(event) => setAudioSendHost(event.target.value)}
              />
              <SetupField
                label="TotalMix send port"
                value={audioSendPort}
                onChange={(event) => setAudioSendPort(event.target.value)}
              />
              <SetupField
                label="TotalMix receive port"
                value={audioReceivePort}
                onChange={(event) => setAudioReceivePort(event.target.value)}
              />
            </>
          }
          actions={
            <>
              {primaryKey}
              {backKey}
            </>
          }
          record={
            <>
              <SetupRecordHeading>What each probe answered</SetupRecordHeading>
              {probeChecks(checks).map((check) => (
                <div key={check.id} className={styles.probeRecord}>
                  <SetupRecordRow
                    label={check.label}
                    value={probeWord(check.status)}
                    tone={probeTone(check.status)}
                    testId={`setup-probe-record-${check.id}`}
                  />
                  <p className={styles.checkDetail}>{check.detail}</p>
                  <div className={styles.inlineActions}>
                    <Key
                      size="small"
                      disabled={busyAction !== null}
                      testId={`setup-probe-run-${check.id}`}
                      onClick={() =>
                        void performAction(`probe-${check.id}`, () =>
                          runSingleProbe(check.id as "control-surface" | "lighting" | "audio")
                        )
                      }
                    >
                      Run probe
                    </Key>
                    {check.checkedAt ? (
                      <span className={styles.metaCopy}>Last run {formatBackupTimestamp(check.checkedAt)}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </>
          }
          testId="setup-screen-probe"
        />
      ) : null}
    </>
  );
}
