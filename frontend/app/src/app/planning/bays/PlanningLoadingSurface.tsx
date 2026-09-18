import planningStyles from "../PlanningWorkspace.module.css";
import { planningPercentForMinute } from "../planningHelpers";
import { boardColumns } from "../planningWorkspaceModel";
import type { PlanningEditor } from "../usePlanningEditor";

/** What the bay shows until the first planning snapshot arrives. */
export function PlanningLoadingSurface({ editor }: { editor: PlanningEditor }) {
  const {
    loadingModeSection,
    planningTimelineVariables,
    timelineMinorTicks,
    timelineStartMinute,
    timelineRangeMinutes,
  } = editor.view;
  return (
    <div
      aria-busy="true"
      aria-label="Planning workspace"
      className={planningStyles.planningWorkspace}
      data-testid="planning-workspace"
      role="region"
    >
      {loadingModeSection === "board" ? (
        <div className={planningStyles.planningBoardShell}>
          {boardColumns.map((column) => (
            <section
              key={`planning-loading-${column.id}`}
              className={planningStyles.planningBoardColumn}
              data-testid={`planning-board-column-${column.id}`}
            >
              <div className={planningStyles.planningBoardColumnHead}>
                <span>{column.label}</span>
                <span>…</span>
              </div>
              <div className={planningStyles.planningLoadingBoardColumn}>
                {Array.from({ length: 2 }, (_, index) => (
                  <div
                    key={`planning-loading-${column.id}-${index}`}
                    className={planningStyles.planningLoadingBoardCard}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={planningStyles.planningShell} style={planningTimelineVariables}>
          <div className={planningStyles.planningScale}>
            <div className={planningStyles.planningScaleHead}>
              <span>Project</span>
              <span>Loading planning…</span>
            </div>
            <div className={planningStyles.planningScaleTicks}>
              {timelineMinorTicks.map((minute) => (
                <div
                  key={`planning-loading-half-hour-${minute}`}
                  className={planningStyles.planningScaleMinorTick}
                  style={{
                    left: planningPercentForMinute(minute, timelineStartMinute, timelineRangeMinutes),
                  }}
                />
              ))}
            </div>
          </div>
          <div className={planningStyles.planningLoadingLanes}>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={`planning-loading-${index}`} className={planningStyles.planningLoadingLane}>
                <div className={planningStyles.planningLoadingHead} />
                <div className={planningStyles.planningLoadingBody} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
