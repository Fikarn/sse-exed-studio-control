import { SetupStepScreen, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import styles from "../SetupSupportPilot.module.css";
import { statusToneLabel, formatBackupTimestamp } from "../../shellData";
import { Key } from "@sse/design-system";
import { runnerStepOrder, probeChecks } from "../setupPilotModel";
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
          lead="Run the deck, bridge and desk probes in one pass. What each one reports also shows under Probes and in Support, so recovery starts from the same place."
          rules={[
            {
              id: "green",
              text: "Every probe must be green before publish; a probe that is not green asks for an explicit override and records it.",
              tone: probeHasError
                ? "error"
                : setupState.passedProbeCount === setupState.probeCount
                  ? "ok"
                  : "attention",
            },
          ]}
          facts={
            <>
              <label className={styles.field}>
                <span>Lighting bridge IP</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setLightingBridgeIp(event.target.value)}
                  placeholder="192.168.1.80"
                  value={lightingBridgeIp}
                />
              </label>
              <label className={styles.field}>
                <span>Lighting universe</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setLightingUniverse(event.target.value)}
                  value={lightingUniverse}
                />
              </label>
              <label className={styles.field}>
                <span>TotalMix send host</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setAudioSendHost(event.target.value)}
                  value={audioSendHost}
                />
              </label>
              <label className={styles.field}>
                <span>TotalMix send port</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setAudioSendPort(event.target.value)}
                  value={audioSendPort}
                />
              </label>
              <label className={styles.field}>
                <span>TotalMix receive port</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setAudioReceivePort(event.target.value)}
                  value={audioReceivePort}
                />
              </label>
            </>
          }
          actions={
            <>
              {primaryKey}
              {backKey}
            </>
          }
          note={`${setupState.passedProbeCount} of ${setupState.probeCount} probes passed. A probe that fails never advances the runner on its own.`}
          record={
            <>
              <SetupRecordHeading>What each probe reports</SetupRecordHeading>
              {probeChecks(checks).map((check) => (
                <div key={check.id} className={styles.probeRecord}>
                  <SetupRecordRow
                    label={check.label}
                    value={statusToneLabel(check.status)}
                    tone={check.status === "ok" ? "ok" : check.status === "error" ? "error" : "attention"}
                    testId={`setup-probe-record-${check.id}`}
                  />
                  <div className={styles.checkDetail}>{check.detail}</div>
                  <div className={styles.inlineActions}>
                    <Key
                      size="small"
                      disabled={busyAction !== null}
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
