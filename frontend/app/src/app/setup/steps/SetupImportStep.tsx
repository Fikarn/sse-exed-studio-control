import { SetupField, SetupStepScreen, SetupRecordSection, SetupRecordRow } from "../components/SetupStepScreen";
import { Key } from "@sse/design-system";
import { healthCheckTone } from "../../shellData";
import { hardwareProfileWord } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner step 1: the deck's profile for Companion. */
export function SetupImportStep({ editor }: { editor: SetupPilot }) {
  const { commissioningSnapshot } = editor.props;
  const { activeStepId, setExportBaseUrl, exportBaseUrl, runtimePaths, controlSurface, pages, totalControlCount } =
    editor.state;
  const { stepEyebrow, primaryKey } = editor.chrome;
  const { performAction, saveImportProfile } = editor.actions;
  // The bridge's standing colours its sentence only when it is not ok.
  const bridge = healthCheckTone(controlSurface?.status);
  return (
    <>
      {activeStepId === "import" ? (
        <SetupStepScreen
          eyebrow={stepEyebrow}
          title="Import the Companion profile"
          lead="Export the deck's profile for Companion: its pages, keys and dials, made from what Studio Control holds. It lands in the exports folder."
          // What to do in Companion stays on screen: the import replaces what
          // Companion holds (docs/HARDWARE.md, "To put the profile on the deck").
          rules={[
            { id: "companion", text: "Start Companion first: the export asks it for the deck." },
            {
              id: "reset",
              text: "In Companion, import it with Full Reset & Import, then check that Horizontal Swipe Changes Page is off for the deck.",
            },
          ]}
          facts={
            <SetupField
              label="Server base URL"
              wide
              placeholder="http://127.0.0.1:38201"
              value={exportBaseUrl}
              onChange={(event) => setExportBaseUrl(event.target.value)}
            />
          }
          actions={
            <>
              {primaryKey}
              <Key
                size="large"
                testId="setup-download-companion"
                onClick={() => void performAction("export-companion-inline", () => saveImportProfile(false))}
              >
                Export only
              </Key>
            </>
          }
          record={
            <SetupRecordSection title="Before you start">
              <SetupRecordRow
                label="Companion link"
                value={String(controlSurface?.summary ?? "Pending")}
                tone={bridge === "ok" || bridge === "error" ? bridge : "attention"}
              />
              <SetupRecordRow label="Deck pages" value={String(pages.length)} tone={pages.length > 0 ? "ok" : "off"} />
              <SetupRecordRow
                label="Mapped controls"
                value={String(totalControlCount)}
                tone={totalControlCount > 0 ? "ok" : "off"}
              />
              <SetupRecordRow
                label="Hardware profile"
                value={hardwareProfileWord(commissioningSnapshot?.hardwareProfile, "not reported")}
              />
              {/* The visual overhaul's polish (2026-10-05): where the profile
                  lands, a fact and not a locked field; it named the app-data
                  folder, one above it. */}
              <SetupRecordRow
                label="Exports folder"
                value={String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? "not reported")}
              />
            </SetupRecordSection>
          }
          testId="setup-screen-import"
        />
      ) : null}
    </>
  );
}
