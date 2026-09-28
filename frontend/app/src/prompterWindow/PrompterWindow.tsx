import { Component, useEffect, useState, type ReactNode } from "react";

import type { GlassLink } from "@sse/engine-client";

import { GLASS_HEIGHT, GLASS_WIDTH } from "../app/teleprompter/glass/glassLayout";
import { PrompterGlass, type PrompterGlassLayoutReport } from "../app/teleprompter/glass/PrompterGlass";
import { useLiveCallback } from "../app/shared/useLiveCallback";
import { followGlass, NOTHING_DRAWN, type GlassView } from "./glassFollower";
import styles from "./PrompterWindow.module.css";

// The prompter's window (the design's §7): the glass, and nothing else. It is
// the Prompter XL's whole screen, black where the glass is not, without a
// pointer, a menu or a word of Studio Control's own: the presenter reads the
// script's words and no others.
//
// It draws the glass as large as the window lets it, 16:9 and in the middle.
// On the Prompter XL that is the whole screen, in the screen's own pixels
// whatever scaling Windows has set for it: the glass is laid out at 1,920 px
// and scaled to the window.

/** Once a second the page tells the shell that it draws. */
const ALIVE_EVERY_MS = 1000;

function windowSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The glass's width in a window of this size: all of it, at 16:9. */
export function glassWidthIn(width: number, height: number): number {
  return Math.max(Math.min(width, (height * GLASS_WIDTH) / GLASS_HEIGHT), 0);
}

interface GlassBoundaryProps {
  onProblem: (problem: string) => void;
  children: ReactNode;
}

/** A glass that cannot be drawn leaves the window black, and says why. */
class GlassBoundary extends Component<GlassBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onProblem(error instanceof Error ? error.message : String(error));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface PrompterWindowProps {
  link: GlassLink;
}

export function PrompterWindow({ link }: PrompterWindowProps) {
  const [view, setView] = useState<GlassView>(NOTHING_DRAWN);
  const [size, setSize] = useState(windowSize);
  const [drawProblem, setDrawProblem] = useState<string | null>(null);

  useEffect(
    () =>
      followGlass(link, setView, {
        onFailure: (error, doing) => console.warn(`The prompter's window, ${doing}:`, error),
      }),
    [link]
  );

  useEffect(() => {
    const resized = () => setSize(windowSize());
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  // The sign of life, once a second from the moment the page draws. What
  // keeps the page from drawing goes with it.
  const problem = drawProblem ?? view.problem;
  useEffect(() => {
    const say = () => {
      link.alive(problem ?? undefined).catch((error: unknown) => {
        console.warn("The prompter's window could not tell the shell that it draws:", error);
      });
    };
    say();
    const id = window.setInterval(say, ALIVE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [link, problem]);

  const report = useLiveCallback((layout: PrompterGlassLayoutReport) => {
    // A report the hardware link did not take is sent again when it asks
    // (`PrompterGlass`).
    link.reportLayout(layout).catch((error: unknown) => {
      console.warn("The prompter's window could not report its layout:", error);
    });
  });

  return (
    <div
      className={styles.window}
      data-testid="prompter-window"
      data-stands={view.stoppedAfterMs === null ? undefined : ""}
      // The text stands where the hardware link's own layout has it: the
      // layout was reported, and its anchor came back.
      data-laid-out={view.anchor !== null && view.anchor.position !== null ? "" : undefined}
      onContextMenu={(event) => event.preventDefault()}
    >
      <GlassBoundary onProblem={setDrawProblem}>
        <PrompterGlass
          text={view.text}
          anchor={view.anchor}
          width={glassWidthIn(size.width, size.height)}
          stoppedAfterMs={view.stoppedAfterMs}
          onLayout={report}
          label="The prompter's glass"
          testId="prompter-window-glass"
        />
      </GlassBoundary>
    </div>
  );
}
