import { lightingFixtureColor } from "../lightingHelpers";

export interface LightPoolProps {
  id: string;
  centerX: number;
  centerY: number;
  radius: number;
  intensity: number;
  cct: number;
  on: boolean;
}

export function LightPool({ id, centerX, centerY, radius, intensity, cct, on }: LightPoolProps) {
  if (!on || intensity <= 0) {
    return null;
  }
  const color = lightingFixtureColor(cct, on);
  const opacity = Math.min(0.45, 0.15 + (intensity / 100) * 0.3);
  const gradientId = `pool-${id}`;

  return (
    <g aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="60%" stopColor={color} stopOpacity={opacity * 0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={centerX} cy={centerY} r={radius} fill={`url(#${gradientId})`} />
    </g>
  );
}
