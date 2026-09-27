import { Footer } from "@sse/design-system";
import type { PrompterSnapshot } from "@sse/engine-client";

import type { GlassParagraph } from "./glass/glassText";
import { formatDuration } from "./prompterTime";
import { placeView, screenMode } from "./teleprompterModel";

// The Teleprompter's footer (new pages program, Slice 6a; board 1): the
// Prompter XL, what is on the glass, the place, the speed and the time left.

export interface TeleprompterFooterProps {
  snapshot: PrompterSnapshot;
  cut: readonly GlassParagraph[];
  timeLeft: number | null;
}

export function TeleprompterFooter({ snapshot, cut, timeLeft }: TeleprompterFooterProps) {
  const glass = snapshot.glass;
  const place = glass && cut.length > 0 ? placeView(glass, cut).text : "—";
  return (
    <Footer
      testId="teleprompter-footer"
      items={[
        { id: "screen", label: "Prompter XL", value: screenMode(snapshot) ?? snapshot.screen.word.toLowerCase() },
        { id: "glass", label: "On the glass", value: glass ? glass.name : "nothing" },
        { id: "place", label: "Place", value: place },
        { id: "speed", label: "Speed", value: glass ? `${glass.speedWpm} words/min` : "—" },
        { id: "left", label: "Left", value: timeLeft !== null ? formatDuration(timeLeft) : "—" },
      ]}
    />
  );
}
