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
        fill="rgba(7, 12, 22, 0.85)"
        stroke="rgba(63, 112, 200, 0.55)"
        strokeWidth={1}
      />
      <text
        x={0}
        y={padY - 1}
        fontSize={11}
        fontFamily="JetBrains Mono Variable, ui-monospace, monospace"
        fontWeight={600}
        fill="#6A93DC"
        textAnchor="middle"
      >
        {text}
      </text>
    </g>
  );
}
