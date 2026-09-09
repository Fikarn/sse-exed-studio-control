import { Footer } from "@sse/design-system";

import { formatShortcut } from "../../shared/shortcutGlyphs";
import { formatPlanningElapsed, type PlanningDayFacts } from "../planningState";

// Visual overhaul A, Slice 6 (system §2): Planning's footer is the shell's. It
// carries the day the operator is looking at and what is on it, plus the keys
// that move the day, so the numbers the cluster states are never off screen.

export interface PlanningFooterProps {
  facts: PlanningDayFacts;
  viewDayLabel: string;
}

// Slice 8 (system §9): every number carries its unit, and one task is
// never "1 tasks".
function taskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

export function PlanningFooter({ facts, viewDayLabel }: PlanningFooterProps) {
  return (
    <Footer
      items={[
        { id: "day", label: "Day", value: viewDayLabel },
        { id: "scheduled", label: "Scheduled", value: taskCount(facts.scheduledCount) },
        { id: "unscheduled", label: "Unscheduled", value: taskCount(facts.unscheduledCount) },
        { id: "done", label: "Done", value: taskCount(facts.doneCount) },
        { id: "tracked", label: "Tracked today", value: formatPlanningElapsed(facts.trackedTotalSeconds) },
      ]}
      hints={[
        { kbd: formatShortcut(["mod", "K"]), label: "Command palette" },
        { kbd: "?", label: "Shortcuts" },
        { kbd: "N", label: "New project" },
        { kbd: ["[", "]"], label: "Hour" },
        { kbd: [formatShortcut(["shift", "["]), formatShortcut(["shift", "]"])], label: "Day" },
      ]}
      testId="planning-health-bar"
      itemsTestId="planning-footer-telemetry"
      hintsTestId="planning-footer-shortcuts"
    />
  );
}
