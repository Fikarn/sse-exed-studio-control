// Visual overhaul A, Slice 6 (A-planning.html's screen): where a card sits on
// the timeline. The card is a fixed-width box pinned to the task's start; the
// duration is drawn as a bar under its top edge, clipped at the axis end. A
// card whose box would run off the right edge hangs to the left of its start
// instead, and a card whose box would cover another card in the same lane drops
// to the next row. Pure geometry, so it can be measured without a browser.

export interface PlanningLaneLayoutTask {
  id: string;
  /** Minutes past midnight the task starts. */
  startMinute: number;
  /** How long the engine says it runs, in minutes. */
  durationMinutes: number;
}

export interface PlanningLaneLayoutOptions {
  /** Card width in px. */
  cardWidth: number;
  /** Card height in px, used to work out how many rows a lane can hold. */
  cardHeight: number;
  /** Gap between the card rows, and the right-edge margin. */
  gap: number;
  /** How many rows the lane has room for; at least 1. */
  rowCapacity: number;
  /** Width of the time axis in px (the lane body, not the label column). */
  width: number;
  startMinute: number;
  rangeMinutes: number;
}

export interface PlanningLaneLayoutEntry {
  id: string;
  /** Left edge of the card box, px from the start of the axis. */
  x: number;
  /** Which row of the lane the card sits on (0 is the top row). */
  row: number;
  /** True when the card hangs to the left of its start time. */
  hangsLeft: boolean;
  /** Left edge of the duration bar: always the task's start. */
  barLeft: number;
  /** Bar width in px, clipped at the axis end. */
  barWidth: number;
}

export function planningAxisX(minute: number, startMinute: number, rangeMinutes: number, width: number) {
  const fraction = Math.max(0, Math.min(1, (minute - startMinute) / Math.max(1, rangeMinutes)));
  return fraction * width;
}

export function layoutPlanningLane(
  tasks: readonly PlanningLaneLayoutTask[],
  { cardWidth, gap, rowCapacity, width, startMinute, rangeMinutes }: PlanningLaneLayoutOptions
): PlanningLaneLayoutEntry[] {
  const rows: { x: number; row: number }[] = [];
  const maxRow = Math.max(0, Math.floor(rowCapacity) - 1);

  return [...tasks]
    .sort((left, right) => left.startMinute - right.startMinute)
    .map((task) => {
      const barLeft = planningAxisX(task.startMinute, startMinute, rangeMinutes, width);
      // The card hangs left only when its box would otherwise leave the screen.
      const hangsLeft = barLeft + cardWidth + gap > width;
      const x = Math.max(0, hangsLeft ? barLeft - cardWidth : barLeft);

      let row = 0;
      while (
        row < maxRow &&
        rows.some((placed) => placed.row === row && placed.x < x + cardWidth + gap && placed.x + cardWidth + gap > x)
      ) {
        row += 1;
      }
      rows.push({ row, x });

      const barEnd = planningAxisX(
        task.startMinute + Math.max(1, task.durationMinutes),
        startMinute,
        rangeMinutes,
        width
      );
      return {
        barLeft,
        barWidth: Math.max(4, barEnd - barLeft),
        hangsLeft,
        id: task.id,
        row,
        x,
      };
    });
}

/** How many card rows fit in a lane of this height. A lane always offers the
 *  second row A-planning.html draws — below the studio surface it is clipped by
 *  the lane rather than dropped, because two cards on one row would print over
 *  each other and neither title could be read. */
export function planningLaneRowCapacity(laneHeight: number, cardHeight: number, top: number, gap: number) {
  return Math.max(2, Math.floor((laneHeight - top + gap) / (cardHeight + gap)));
}

/** Which hours get a printed label: every one when there is room, else every
 *  other one, so two labels never touch (A-planning.html's 90 px rule). */
export function planningLabelledHours(hours: readonly number[], hourWidth: number) {
  if (hourWidth >= 90) return new Set(hours);
  const labelled = new Set<number>();
  hours.forEach((hour, index) => {
    if (index % 2 === 0) labelled.add(hour);
  });
  return labelled;
}
