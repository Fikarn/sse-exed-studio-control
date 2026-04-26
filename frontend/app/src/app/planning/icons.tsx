// Icons used by the Planning workspace. Currently only the toolbar's clock
// glyph; new icons should land here so the workspace stays JSX-only.
export function PlanningClockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
