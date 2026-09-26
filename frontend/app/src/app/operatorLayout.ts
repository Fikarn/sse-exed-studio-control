// New pages program, Slice SW (D22): Studio Control runs at 2560 × 1440 and at
// nothing else, so the layout modes and Studio Preview are gone. The UI scale
// stays: it is the operator's preference, not a screen size.
export type OperatorUiScale = 90 | 100 | 110 | 125;

export const OPERATOR_UI_SCALES: readonly OperatorUiScale[] = [90, 100, 110, 125];

export function isOperatorUiScale(value: number): value is OperatorUiScale {
  return OPERATOR_UI_SCALES.includes(value as OperatorUiScale);
}
