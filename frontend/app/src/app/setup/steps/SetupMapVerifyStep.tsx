import { Key, Segmented } from "@sse/design-system";

import { SetupStepScreen, SetupRecordSection, SetupRecordRow } from "../components/SetupStepScreen";
import styles from "../SetupSupportPilot.module.css";
import { controlKindWord, type ControlSurfaceControl, deckKeySlots } from "../setupPilotModel";
import type { SetupPilot } from "../useSetupPilot";

/** The keys of a Stream Deck +, above its strip: places 1 to 8. */
const KEY_PLACES = 8;

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
  const { stepEyebrow, primaryKey, backKey } = editor.chrome;
  const verifying = activeStepId === "verify";

  // One control of the deck as the screen draws it: its word, the Beige
  // selection, and a lit fill for the moment the deck reports a press of it.
  // `word` prints another word than the control's label; the name keeps it.
  const cell = (control: ControlSurfaceControl, className: string, word?: string) => (
    <button
      key={control.id}
      type="button"
      className={className}
      aria-label={`${control.label} ${controlKindWord(control.type)}`}
      data-echo={verifying && control.id === echoControlId}
      data-selected={control.id === selectedControl?.id}
      data-page-key={control.pageNav ? "" : undefined}
      onClick={() => setSelectedControlId(control.id)}
    >
      <span>{word ?? control.label}</span>
    </button>
  );

  const keys = selectedPage?.buttons.filter((control) => control.position <= KEY_PLACES) ?? [];
  const strip = [...(selectedPage?.buttons.filter((control) => control.position > KEY_PLACES) ?? [])].sort(
    (a, b) => a.position - b.position
  );
  // The dials a column each, under their cell of the strip: the push, then the turns.
  const dialColumns = [1, 2, 3, 4].map((place) =>
    (selectedPage?.dials ?? []).filter((dial) => dial.position === place)
  );

  return (
    <>
      {activeStepId === "map" || verifying ? (
        <SetupStepScreen
          eyebrow={stepEyebrow}
          title={verifying ? "Verify live echo" : "Map bindings"}
          lead={
            verifying
              ? "Press a key or turn a dial on the deck: its cell lights when the deck reports the press."
              : "The deck's four pages as Studio Control holds them, the keys, the strip and the dials, as the profile draws them on the deck."
          }
          rules={
            verifying
              ? [
                  {
                    id: "echo",
                    text: echoControlId
                      ? "The deck reported a press: the cell lights from what it reports, not from this screen."
                      : "Nothing has been pressed yet.",
                    tone: echoControlId ? "ok" : "off",
                  },
                  {
                    id: "transport",
                    text: liveTransportRequested
                      ? "This workstation is wired to the hardware, so a press is real."
                      : "This workstation is running on sample data; presses are simulated.",
                    tone: liveTransportRequested ? "attention" : "off",
                  },
                ]
              : []
          }
          facts={
            selectedPage ? (
              <div className={styles.deck}>
                {/* A page is chosen by its tab, which prints its name and
                    nothing else; the page shown is the Beige selection. */}
                <Segmented label="The deck's pages" className={styles.pageTabs} testId="setup-deck-pages">
                  {pages.map((page) => (
                    <Key
                      key={page.id}
                      mode="segmented"
                      size="small"
                      selected={page.id === selectedPage.id}
                      aria-pressed={page.id === selectedPage.id}
                      data-active={page.id === selectedPage.id}
                      testId={`setup-deck-page-${page.id}`}
                      onClick={() => {
                        setSelectedPageId(page.id);
                        setSelectedControlId(page.buttons[0]?.id ?? page.dials[0]?.id ?? null);
                      }}
                    >
                      {page.label}
                    </Key>
                  ))}
                </Segmented>
                <div className={styles.deckKeys} data-testid="setup-deck-keys">
                  {deckKeySlots(keys).map((control, index) =>
                    control ? (
                      cell(control, styles.deckKey)
                    ) : (
                      // A dark key: black glass, where the deck has it.
                      <span key={`blank-${index + 1}`} aria-hidden="true" className={styles.deckDark} data-blank-key />
                    )
                  )}
                </div>
                {strip.length > 0 ? (
                  <div className={styles.deckStrip} data-testid="setup-deck-strip">
                    {strip.map((control) => cell(control, styles.stripCell))}
                  </div>
                ) : null}
                {/* The visual overhaul's polish (2026-10-05): a dial's push
                    prints Push, for the strip cell above it names the dial;
                    its name still says which dial it is. */}
                <div className={styles.deckDials} data-testid="setup-deck-dials">
                  {dialColumns.map((column, index) => (
                    <div key={index + 1} className={styles.dialColumn}>
                      {column.map((control) =>
                        cell(
                          control,
                          styles.dialChip,
                          control.type === "dial-press" && strip.length > 0 ? "Push" : undefined
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className={styles.emptyState}>The deck has not reported its pages yet. Run all probes to check it.</p>
            )
          }
          actions={
            <>
              {primaryKey}
              {backKey}
            </>
          }
          record={
            <>
              <SetupRecordSection title={verifying ? "The control pressed" : "The control chosen"}>
                {/* While the deck reports its press, the kind is a lit word. */}
                <SetupRecordRow
                  label={selectedControl?.label ?? "Choose a control"}
                  value={selectedControl ? controlKindWord(selectedControl.type) : "—"}
                  tone={verifying && selectedControl?.id === echoControlId ? "ok" : "off"}
                  word={verifying && selectedControl?.id === echoControlId}
                />
                {selectedControl ? <p className={styles.checkDetail}>{selectedControl.description}</p> : null}
              </SetupRecordSection>
              <SetupRecordSection title="The deck as Studio Control holds it">
                <SetupRecordRow
                  label="Pages"
                  value={String(pages.length)}
                  tone={pages.length > 0 ? "ok" : "attention"}
                />
                <SetupRecordRow
                  label="Controls"
                  value={String(totalControlCount)}
                  tone={totalControlCount > 0 ? "ok" : "attention"}
                />
                <SetupRecordRow
                  label="Hardware link"
                  value={liveTransportRequested ? "LIVE" : "SAMPLE DATA"}
                  tone={liveTransportRequested ? "ok" : "off"}
                  word
                />
              </SetupRecordSection>
            </>
          }
          testId={`setup-screen-${activeStepId}`}
        />
      ) : null}
    </>
  );
}
