import { SetupStepScreen, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import styles from "../SetupSupportPilot.module.css";
import { Key } from "@sse/design-system";
import { healthCheckTone } from "../../shellData";
import { runnerStepOrder } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 1: the addresses the workstation talks to. */
export function SetupImportStep({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot } = editor.props;
  const { activeStepId, setExportBaseUrl, exportBaseUrl, runtimePaths, controlSurface, pages, totalControlCount } =
    editor.state;
  const { bayHead, primaryKey } = editor.chrome;
  const { performAction, saveImportProfile } = editor.actions;
  return (
    <>
      {activeStepId === "import" ? (
        <SetupStepScreen
          head={bayHead}
          eyebrow={`Step 1 of ${runnerStepOrder.length}`}
          title="Import the Companion profile"
          lead="Export the ready-to-import deck profile, then load it in Companion on this workstation."
          rules={[
            {
              id: "bindings",
              text: "The profile carries the deck pages and their controls; edit bindings in Map bindings, not in Companion.",
              tone: "off",
            },
            {
              id: "url",
              text: "The server base URL is where Companion reaches this workstation; keep it on the studio network.",
              tone: "off",
            },
          ]}
          facts={
            <>
              <label className={styles.field}>
                <span>Server base URL</span>
                <input
                  className={styles.textField}
                  onChange={(event) => setExportBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:38201"
                  value={exportBaseUrl}
                />
              </label>
              <label className={styles.field}>
                <span>Export target</span>
                <input
                  className={styles.textField}
                  disabled
                  value={String(runtimePaths?.appDataDir ?? "Native runtime path unavailable")}
                />
              </label>
            </>
          }
          actions={
            <>
              {primaryKey}
              <Key
                take
                testId="setup-download-companion"
                onClick={() => void performAction("export-companion-inline", () => saveImportProfile(false))}
              >
                Download Companion profile
              </Key>
            </>
          }
          note="Download profile writes the export, then opens Probe hardware."
          record={
            <>
              <SetupRecordHeading>Before you start</SetupRecordHeading>
              <SetupRecordRow
                label="Companion link"
                value={String(controlSurface?.summary ?? "Pending")}
                tone={healthCheckTone(controlSurface?.status) === "ok" ? "ok" : "attention"}
              />
              <SetupRecordRow label="Deck pages" value={String(pages.length)} tone={pages.length > 0 ? "ok" : "off"} />
              <SetupRecordRow
                label="Mapped controls"
                value={String(totalControlCount)}
                tone={totalControlCount > 0 ? "ok" : "off"}
              />
              <SetupRecordRow
                label="Hardware profile"
                value={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
                tone="off"
              />
            </>
          }
          testId="setup-screen-import"
        />
      ) : null}
    </>
  );
}
