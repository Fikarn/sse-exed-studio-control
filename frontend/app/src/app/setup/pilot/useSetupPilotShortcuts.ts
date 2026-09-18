import { useEffect } from "react";
import { isEditableTarget } from "../../shellData";
import type { SetupPilotState } from "./useSetupPilotState";
import type { SetupPilotActions } from "./useSetupPilotActions";

/** Setup / Support's keyboard shortcuts. */
export function useSetupPilotShortcuts({ state, actions }: { state: SetupPilotState; actions: SetupPilotActions }) {
  const { mode, pendingStepId, activeStepId, pages, setSelectedPageId, setSelectedControlId } = state;
  const { persistMode, moveStepSelection, invokePrimaryAction, moveControlSelection } = actions;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const editableTarget = isEditableTarget(event.target);
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
        persistMode(mode === "runner" ? "support" : "runner");
        event.preventDefault();
        return;
      }

      if (mode !== "runner" || pendingStepId !== null || editableTarget) {
        return;
      }

      if (event.key === "Tab") {
        moveStepSelection(event.shiftKey ? -1 : 1);
        event.preventDefault();
        return;
      }

      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        invokePrimaryAction();
        event.preventDefault();
        return;
      }

      if ((activeStepId === "map" || activeStepId === "verify") && event.key.toLowerCase() === "j") {
        moveControlSelection(-1);
        event.preventDefault();
        return;
      }

      if ((activeStepId === "map" || activeStepId === "verify") && event.key.toLowerCase() === "k") {
        moveControlSelection(1);
        event.preventDefault();
        return;
      }

      if (activeStepId === "map" && /^[1-4]$/.test(event.key)) {
        const page = pages[Number(event.key) - 1];
        if (page) {
          setSelectedPageId(page.id);
          setSelectedControlId(page.buttons[0]?.id ?? page.dials[0]?.id ?? null);
          event.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeStepId,
    invokePrimaryAction,
    mode,
    moveControlSelection,
    moveStepSelection,
    pages,
    pendingStepId,
    persistMode,
    setSelectedControlId,
    setSelectedPageId,
  ]);
}
