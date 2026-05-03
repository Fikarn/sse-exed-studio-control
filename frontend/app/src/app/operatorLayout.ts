export type OperatorLayoutMode = "studioFull" | "desktopCompact" | "narrowUtility" | "constrained";

export type OperatorUiScale = 90 | 100 | 110 | 125;

export type OperatorReviewSurface = "native" | "studioPreview";

export interface OperatorLayoutSize {
  width: number;
  height: number;
}

export const OPERATOR_LAYOUT_MINIMUMS: Record<Exclude<OperatorLayoutMode, "constrained">, OperatorLayoutSize> = {
  studioFull: { width: 1920, height: 1080 },
  desktopCompact: { width: 1440, height: 900 },
  narrowUtility: { width: 1280, height: 800 },
};

export const OPERATOR_UI_SCALES: readonly OperatorUiScale[] = [90, 100, 110, 125];

export const OPERATOR_REVIEW_SURFACES: readonly OperatorReviewSurface[] = ["native", "studioPreview"];

export const OPERATOR_STUDIO_PREVIEW_SIZE: OperatorLayoutSize = { width: 2560, height: 1440 };

export function deriveOperatorLayoutMode(size: OperatorLayoutSize): OperatorLayoutMode {
  const width = Math.floor(size.width);
  const height = Math.floor(size.height);

  if (width >= OPERATOR_LAYOUT_MINIMUMS.studioFull.width && height >= OPERATOR_LAYOUT_MINIMUMS.studioFull.height) {
    return "studioFull";
  }

  if (
    width >= OPERATOR_LAYOUT_MINIMUMS.desktopCompact.width &&
    height >= OPERATOR_LAYOUT_MINIMUMS.desktopCompact.height
  ) {
    return "desktopCompact";
  }

  if (
    width >= OPERATOR_LAYOUT_MINIMUMS.narrowUtility.width &&
    height >= OPERATOR_LAYOUT_MINIMUMS.narrowUtility.height
  ) {
    return "narrowUtility";
  }

  return "constrained";
}

export function isOperatorUiScale(value: number): value is OperatorUiScale {
  return OPERATOR_UI_SCALES.includes(value as OperatorUiScale);
}

export function isOperatorReviewSurface(value: string | null): value is OperatorReviewSurface {
  return OPERATOR_REVIEW_SURFACES.includes(value as OperatorReviewSurface);
}
