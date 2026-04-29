export interface PatchAddressTagProps {
  centerX: number;
  centerY: number;
  dmxStartAddress: number;
}

export function PatchAddressTag({ centerX, centerY, dmxStartAddress }: PatchAddressTagProps) {
  const text = `${String(dmxStartAddress).padStart(3, "0")}`;
  const padX = 7;
  const padY = 4;
  const charWidth = 8;
  const width = text.length * charWidth + padX * 2;
  const height = 18;

  return (
    <g transform={`translate(${centerX}, ${centerY - 22})`} aria-hidden="true">
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={3}
        style={{
          fill: "var(--color-glass-bg-blue)",
          stroke: "var(--color-brand-blue-border)",
          strokeWidth: 1,
        }}
      />
      <text
        x={0}
        y={padY - 1}
        fontSize={11}
        fontWeight={600}
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-family-mono)",
          fill: "var(--color-brand-blue-hot)",
        }}
      >
        {text}
      </text>
    </g>
  );
}
