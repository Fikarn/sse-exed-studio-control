import { SetupStepScreen, SetupRecordHeading, SetupRecordRow } from "../components/SetupStepScreen";
import styles from "../SetupSupportPilot.module.css";
import { runnerStepOrder } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** Runner steps 3 and 4: the Stream Deck's pages and controls, mapped and verified. */
export function SetupMapVerifyStep({ editor }: { editor: SetupPilot }) {
  const { liveTransportRequested } = editor.props;
  const {
    activeStepId,
    echoControlId,
    selectedPage,
    pages,
    setSelectedPageId,
    setSelectedControlId,
    selectedControl,
    totalControlCount,
  } = editor.state;
  const { bayHead, primaryKey, backKey } = editor.chrome;
  return (
    <>
      {activeStepId === "map" || activeStepId === "verify" ? (
        <SetupStepScreen
          head={bayHead}
          eyebrow={`Step ${activeStepId === "map" ? 3 : 4} of ${runnerStepOrder.length}`}
          title={activeStepId === "map" ? "Map bindings" : "Verify live echo"}
          lead={
            activeStepId === "map"
              ? "Review the deck page map Studio Control holds, then confirm each slot label against the hardware before live verification."
              : "Press a button or dial on the deck. The matching cell pulses when the deck reports the press back."
          }
          rules={
            activeStepId === "verify"
              ? [
                  {
                    id: "echo",
                    text: echoControlId
                      ? "The pulse is driven by what the deck reports, not by this screen."
                      : "Nothing has been pressed yet. The cell pulses as soon as the deck answers.",
                    tone: echoControlId ? "ok" : "off",
                  },
                  {
                    id: "transport",
                    text: liveTransportRequested
                      ? "This workstation is wired to the hardware, so a press is real."
                      : "This workstation is running on sample data; presses are simulated.",
                    tone: liveTransportRequested ? "ok" : "off",
                  },
                ]
              : [
                  {
                    id: "pages",
                    text: "Bindings are edited here, not in Companion: the profile is regenerated from what Studio Control holds.",
                    tone: "off",
                  },
                ]
          }
          facts={
            selectedPage ? (
              <div className={styles.deckPreview}>
                <div className={styles.pageTabs}>
                  {pages.map((page, index) => (
                    <button
                      key={page.id}
                      className={styles.pageTab}
                      data-active={page.id === selectedPage?.id}
                      onClick={() => {
                        setSelectedPageId(page.id);
                        setSelectedControlId(page.buttons[0]?.id ?? page.dials[0]?.id ?? null);
                      }}
                      type="button"
                    >
                      {page.label}
                      {activeStepId === "map" ? <small>{index + 1}</small> : null}
                    </button>
                  ))}
                </div>
                <div className={styles.buttonMatrix}>
                  {selectedPage.buttons.map((control) => (
                    <button
                      key={control.id}
                      className={styles.deckButton}
                      data-echo={activeStepId === "verify" && control.id === echoControlId}
                      data-selected={control.id === selectedControl?.id}
                      onClick={() => setSelectedControlId(control.id)}
                      type="button"
                    >
                      <span>{control.label}</span>
                      <small>{control.type}</small>
                    </button>
                  ))}
                </div>
                <div className={styles.dialRow}>
                  {selectedPage.dials.map((control) => (
                    <button
                      key={control.id}
                      className={styles.dialChip}
                      data-echo={activeStepId === "verify" && control.id === echoControlId}
                      data-selected={control.id === selectedControl?.id}
                      onClick={() => setSelectedControlId(control.id)}
                      type="button"
                    >
                      {control.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.emptyState}>
                The deck has not reported its pages yet. Run all probes to check the deck.
              </div>
            )
          }
          actions={
            <>
              {primaryKey}
              {backKey}
            </>
          }
          note={
            activeStepId === "verify" && !echoControlId
              ? "Waiting for a press. Continue when every control you rely on has echoed."
              : undefined
          }
          record={
            <>
              <SetupRecordHeading>{activeStepId === "map" ? "Binding detail" : "Echo detail"}</SetupRecordHeading>
              <SetupRecordRow
                label={selectedControl?.label ?? "Choose a control"}
                value={selectedControl?.type ?? "—"}
                tone={
                  activeStepId === "verify" && selectedControl?.id === echoControlId
                    ? "ok"
                    : selectedControl
                      ? "off"
                      : "attention"
                }
              />
              <div className={styles.checkDetail}>
                {selectedControl?.description ??
                  "Review the current page and make sure the binding description matches the hardware label."}
              </div>
              <SetupRecordHeading>The deck as Studio Control holds it</SetupRecordHeading>
              <SetupRecordRow label="Pages" value={String(pages.length)} tone={pages.length > 0 ? "ok" : "attention"} />
              <SetupRecordRow
                label="Controls"
                value={String(totalControlCount)}
                tone={totalControlCount > 0 ? "ok" : "attention"}
              />
              <SetupRecordRow
                label="Hardware link"
                value={liveTransportRequested ? "live" : "sample data"}
                tone={liveTransportRequested ? "ok" : "off"}
              />
            </>
          }
          testId={`setup-screen-${activeStepId}`}
        />
      ) : null}
    </>
  );
}
