import { enterStudioFullscreen, resetWindowLayout, switchToWindowedLayout } from "../../shellCommands";
import type { SetupPilot } from "../useSetupPilot";

/**
 * New pages program, Slice 3 (decision 2): what the window keys do, one wiring
 * for both places they are drawn: Workstation on the Support plate, and the
 * bay's Support screen while the plate is off screen (review finding 22). A key
 * says nothing when the window moves. A refusal carries the native shell's
 * sentence to the pilot's message line, as every other Setup / Support failure
 * does.
 */
export function windowKeyActions(performAction: SetupPilot["actions"]["performAction"]) {
  return {
    onEnterStudioFullscreen: () => void performAction("window-studio-fullscreen", enterStudioFullscreen),
    onUseWindowedLayout: () => void performAction("window-windowed", switchToWindowedLayout),
    onResetWindowLayout: () => void performAction("window-reset", resetWindowLayout),
  };
}
