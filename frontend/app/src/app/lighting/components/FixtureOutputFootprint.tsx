import type { FixtureVisualModel, StagePlotRenderMode } from "../fixtureVisuals";
import { lightingFixtureColor } from "../lightingHelpers";

export interface FixtureOutputFootprintProps {
  cct: number;
  beamAngle: number | null;
  centerX: number;
  centerY: number;
  fieldAngle: number | null;
  fixtureId: string;
  intensity: number;
  on: boolean;
  renderMode: StagePlotRenderMode;
  rigHeightMeters: number | null;
  rotationDegrees: number;
  visual: FixtureVisualModel;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function modeOpacity(renderMode: StagePlotRenderMode, sampled: boolean) {
  switch (renderMode) {
    case "coverage":
      return 1.35;
    case "photometric":
      return sampled ? 1.45 : 1.05;
    case "pixel":
      return 0.9;
    case "rig":
    default:
      return 0.58;
  }
}

function footprintGeometry(visual: FixtureVisualModel, rigHeightMeters: number | null) {
  const beamAngle = visual.output.beamAngle ?? 50;
  const height = clamp(rigHeightMeters ?? 3.2, 1, 8);
  const spreadMeters = Math.tan((clamp(beamAngle, 1, 170) * Math.PI) / 360) * height * 2;
  const width = clamp(spreadMeters * 100, 90, 760);
  const length = clamp(width * (visual.output.beamType === "rectangle" ? 0.72 : 1.34), 120, 960);
  return { length, width };
}

function wedgePath(length: number, width: number, tightness: number) {
  const start = Math.max(5, width * 0.05);
  const end = width * tightness;
  return `M ${-start} 0 C ${-end * 0.35} ${length * 0.38}, ${-end} ${length * 0.72}, ${-end} ${length} L ${end} ${length} C ${end} ${length * 0.72}, ${end * 0.35} ${length * 0.38}, ${start} 0 Z`;
}

export function FixtureOutputFootprint({
  beamAngle,
  cct,
  centerX,
  centerY,
  fieldAngle,
  fixtureId,
  intensity,
  on,
  renderMode,
  rigHeightMeters,
  rotationDegrees,
  visual,
}: FixtureOutputFootprintProps) {
  const { beamType, hasPhotometricSamples, photometricLabel } = visual.output;
  if (!on || intensity <= 0 || beamType === "none" || beamType === "glow") {
    return null;
  }

  const color = lightingFixtureColor(cct, true);
  const normalized = clamp(intensity / 100, 0, 1);
  const opacity = clamp(
    (0.08 + Math.pow(normalized, 0.82) * 0.24) * modeOpacity(renderMode, hasPhotometricSamples),
    0.06,
    0.52
  );
  const { length, width } = footprintGeometry(
    { ...visual, output: { ...visual.output, beamAngle: beamAngle ?? visual.output.beamAngle } },
    rigHeightMeters
  );
  const gradientId = `fixture-output-${fixtureId}`;
  const label = renderMode === "photometric" ? photometricLabel : null;

  if (beamType === "rectangle") {
    const rectWidth = clamp(Math.max(width, visual.body.width * 6), 120, 780);
    const rectHeight = clamp(length * 0.42, 70, 320);
    return (
      <g
        aria-hidden="true"
        data-beam-angle={beamAngle ?? undefined}
        data-field-angle={fieldAngle ?? undefined}
        data-fixture-output-id={fixtureId}
        data-output-beam-type={beamType}
        data-render-mode={renderMode}
        transform={`translate(${centerX}, ${centerY}) rotate(${rotationDegrees})`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={opacity * 0.82} />
            <stop offset="75%" stopColor={color} stopOpacity={opacity * 0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect
          x={-rectWidth / 2}
          y={28}
          width={rectWidth}
          height={rectHeight}
          rx={rectHeight * 0.18}
          fill={`url(#${gradientId})`}
        />
        {renderMode === "pixel" && visual.emitterLayout ? (
          <g opacity={0.45}>
            {Array.from({ length: Math.min(16, visual.emitterLayout.segments) }, (_, index) => {
              const x = -rectWidth / 2 + ((index + 0.5) * rectWidth) / Math.min(16, visual.emitterLayout!.segments);
              return (
                <line
                  key={`pixel-footprint-${index}`}
                  x1={x}
                  x2={x}
                  y1={34}
                  y2={rectHeight + 18}
                  stroke="var(--color-brand-green)"
                  strokeWidth={0.7}
                />
              );
            })}
          </g>
        ) : null}
        {label ? (
          <text
            x={0}
            y={rectHeight + 48}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            letterSpacing={0}
            pointerEvents="none"
            style={{
              fill: hasPhotometricSamples ? "var(--color-brand-green)" : "var(--color-brand-text-muted)",
              fontFamily: "var(--font-family-mono)",
            }}
          >
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  const hard = beamType === "spot" ? 0.42 : beamType === "fresnel" ? 0.62 : 0.8;
  return (
    <g
      aria-hidden="true"
      data-beam-angle={beamAngle ?? undefined}
      data-field-angle={fieldAngle ?? undefined}
      data-fixture-output-id={fixtureId}
      data-output-beam-type={beamType}
      data-render-mode={renderMode}
      transform={`translate(${centerX}, ${centerY}) rotate(${rotationDegrees})`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="70%" stopColor={color} stopOpacity={opacity * 0.34} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={wedgePath(length, width, hard)} fill={`url(#${gradientId})`} />
      {renderMode === "coverage" || renderMode === "photometric" ? (
        <ellipse
          cx={0}
          cy={length}
          rx={width * hard}
          ry={Math.max(28, width * 0.18)}
          fill="none"
          stroke={color}
          strokeOpacity={opacity * 0.88}
          strokeWidth={1}
          strokeDasharray={beamType === "wash" ? "4 4" : undefined}
        />
      ) : null}
      {beamType === "fresnel" || beamType === "spot" ? (
        <line
          x1={0}
          x2={0}
          y1={0}
          y2={length}
          stroke="var(--color-stage-beam-line)"
          strokeOpacity={renderMode === "rig" ? 0.28 : 0.5}
          strokeWidth={0.9}
        />
      ) : null}
      {label ? (
        <text
          x={0}
          y={length + 22}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          letterSpacing={0}
          pointerEvents="none"
          style={{
            fill: hasPhotometricSamples ? "var(--color-brand-green)" : "var(--color-brand-text-muted)",
            fontFamily: "var(--font-family-mono)",
          }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
