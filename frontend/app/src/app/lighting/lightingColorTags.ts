// Wave 30b — operator-assigned color tag palette for scenes + groups (I4).
// Mirrors the engine's `colorIndex: 0..7 | null` schema shipped in Wave 30a.
// Indices match the order of the spec palette so a stored value of 0 always
// means rose, 7 always means pink, etc. Don't reorder — persisted state holds
// indices, not hex.

export const LIGHTING_COLOR_TAG_PALETTE = [
  { index: 0, name: "Rose", hex: "#fb7185" },
  { index: 1, name: "Orange", hex: "#fb923c" },
  { index: 2, name: "Yellow", hex: "#facc15" },
  { index: 3, name: "Lime", hex: "#a3e635" },
  { index: 4, name: "Emerald", hex: "#34d399" },
  { index: 5, name: "Cyan", hex: "#22d3ee" },
  { index: 6, name: "Violet", hex: "#a78bfa" },
  { index: 7, name: "Pink", hex: "#f472b6" },
] as const;

export type LightingColorTagSwatch = (typeof LIGHTING_COLOR_TAG_PALETTE)[number];

export function lightingColorTagHex(index: number | null | undefined): string | null {
  if (index === null || index === undefined) return null;
  return LIGHTING_COLOR_TAG_PALETTE[index]?.hex ?? null;
}

export function lightingColorTagName(index: number | null | undefined): string | null {
  if (index === null || index === undefined) return null;
  return LIGHTING_COLOR_TAG_PALETTE[index]?.name ?? null;
}
