import planningStyles from "../PlanningWorkspace.module.css";
import { formatPlanningHourLabel } from "../planningHelpers";
import { Segmented, Key } from "@sse/design-system";
import { planningFilters } from "../planningWorkspaceModel";
import type { PlanningEditor } from "../usePlanningEditor";

/** The head of the bay's screen: what the picture is, the filters, the search. */
export function PlanningScreenHead({ editor }: { editor: PlanningEditor }) {
  const {
    settings,
    timelineStartMinute,
    timelineEndMinute,
    setPlanningSearchQuery,
    planningSearchInputRef,
    planningSearchQuery,
  } = editor.view;
  const { updatePlanningViewFilter } = editor.actions;
  // The screen's own header: what the picture is, then the filters and the
  // search that narrow it — the toolbar's two controls, on the thing they act on.
  const planningScreenHead = (
    <>
      <span className={planningStyles.planningScreenTitle}>
        {settings.modeSection === "board" ? "Board" : "Timeline"}
      </span>
      <span className={planningStyles.planningScreenDetail}>
        {settings.modeSection === "board"
          ? "one card per project · drag a card to move it between columns"
          : `${formatPlanningHourLabel(Math.floor(timelineStartMinute / 60))} – ${formatPlanningHourLabel(
              Math.floor(timelineEndMinute / 60)
            )} · one lane per project · a card sits at its start, the bar is its duration`}
      </span>
      <Segmented label="Planning filter" className={planningStyles.planningFilters} testId="planning-filter-switch">
        {planningFilters.map((filter) => (
          <Key
            key={filter.value}
            mode="segmented"
            size="small"
            cap={filter.label}
            engaged={settings.viewFilter === filter.value}
            role="radio"
            aria-checked={settings.viewFilter === filter.value}
            testId={`planning-filter-${filter.value}`}
            onClick={() => updatePlanningViewFilter(filter.value)}
          />
        ))}
      </Segmented>
      <input
        aria-label="Search tasks and projects"
        className={planningStyles.planningScreenSearch}
        data-toolbar-primary="search"
        data-well=""
        onChange={(event) => setPlanningSearchQuery(event.currentTarget.value)}
        placeholder="Search tasks and projects"
        ref={planningSearchInputRef}
        type="search"
        value={planningSearchQuery}
      />
    </>
  );
  return planningScreenHead;
}
