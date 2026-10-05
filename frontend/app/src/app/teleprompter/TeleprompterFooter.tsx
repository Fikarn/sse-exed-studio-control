import { useRef, useState } from "react";

import { Footer, Key, Popover, Readouts } from "@sse/design-system";
import type { PrompterSnapshot } from "@sse/engine-client";

import { screenMode } from "./teleprompterModel";
import styles from "./TeleprompterFooter.module.css";

// The Teleprompter's footer (new pages program, Slice 6a; board 1): the
// Prompter XL's mode.
//
// The visual overhaul (2026-10-05): its one action key opens the Prompter XL
// as Windows reports it, in a popover over the footer: the state in the
// hardware link's word, the resolution, the refresh and how Windows shows it.
// The key never moves. The window's own reason, while it stands, is on the
// plate too, since a reason is never only in a popover.
//
// The polish (2026-10-05): the footer repeats nothing the page prints above
// it, so what is on the prompter, the place, the speed and the time left are
// the bay strip's and the speed dial's alone. The mode stays: the state
// display leaves it out beside its Update key.

export interface TeleprompterFooterProps {
  snapshot: PrompterSnapshot;
}

/** The Prompter XL's readouts, as Windows reports them through the shell. */
function screenRows(snapshot: PrompterSnapshot) {
  const { screen } = snapshot;
  return [
    {
      id: "state",
      label: "State",
      value: screen.word,
      tone:
        screen.tone === "ok"
          ? ("ok" as const)
          : screen.tone === "attention"
            ? ("attention" as const)
            : ("error" as const),
    },
    {
      id: "resolution",
      label: "Resolution",
      value: screen.width !== null && screen.height !== null ? `${screen.width}×${screen.height}` : "—",
    },
    { id: "refresh", label: "Refresh", value: screen.refreshHz !== null ? `${screen.refreshHz} Hz` : "—" },
    {
      id: "shows",
      label: "Windows shows it",
      value: screen.state === "duplicated" ? "a copy of another screen" : screen.width !== null ? "extended" : "—",
    },
  ];
}

export function TeleprompterFooter({ snapshot }: TeleprompterFooterProps) {
  const [open, setOpen] = useState(false);
  // The key that opens the readouts: a press on it closes them again, and the
  // focus comes back to it.
  const opener = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      <Footer
        testId="teleprompter-footer"
        items={[{ id: "screen", label: "Prompter XL", value: screenMode(snapshot) ?? snapshot.screen.word }]}
        action={
          <span ref={opener} className={styles.opener}>
            <Key
              size="small"
              aria-expanded={open}
              testId="teleprompter-screen-open"
              onClick={() => setOpen((was) => !was)}
            >
              Prompter XL…
            </Key>
          </span>
        }
      />
      <Popover
        open={open}
        anchor={opener.current}
        onClose={() => setOpen(false)}
        title="The Prompter XL, as Windows reports it"
        placement="top-end"
        width={407}
        ignoreOutside={[opener]}
        returnFocusTo={opener.current?.querySelector("button") ?? null}
        initialFocus="panel"
        testId="teleprompter-screen-popover"
      >
        <Readouts rows={screenRows(snapshot)} data-testid="teleprompter-screen-readouts" />
        {snapshot.screen.windowError ? <p className={styles.windowError}>{snapshot.screen.windowError}</p> : null}
      </Popover>
    </>
  );
}
