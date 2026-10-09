import { useEffect } from "react";

import type { PrompterSnapshot, ShellStore } from "@sse/engine-client";

/**
 * While the text scrolls the hardware link moves the place about once a
 * second and says nothing (it saves it; a take has no event a second), so a
 * page that shows the place reads the prompter's state once a second to
 * follow it: the place, the paragraph at the reading line, the time left, the
 * cues ahead. It reads as often while it waits: for the prompter's state when
 * the start could not read it, and while the text is not laid out, so a read
 * of the glass's text that failed is tried again (the store reads the text
 * whenever its key has moved). The Teleprompter page and the Overview (D47)
 * both follow it.
 */
export function usePrompterFollow(store: ShellStore, prompterSnapshot: PrompterSnapshot | null) {
  const glass = prompterSnapshot?.glass ?? null;
  const following = (glass?.playing ?? false) || !prompterSnapshot || (glass !== null && !glass.laidOut);
  useEffect(() => {
    if (!following) return undefined;
    const id = window.setInterval(() => {
      store
        .refreshPrompterSnapshot()
        .catch((error: unknown) => store.reportBackgroundFailure(error, "the prompter's place"));
    }, 1000);
    return () => window.clearInterval(id);
  }, [following, store]);
}
