// Wave 30b — operator-assigned color tag palette for scenes + groups (I4).
// Mirrors the engine's `colorIndex: 0..7 | null` schema shipped in Wave 30a.
// Persisted state holds indices, not colours, so the order never changes: a
// stored value keeps its slot whatever the slot is called.
//
// The visual overhaul's polish (2026-10-05, the owner's yes): the eight tags
// are the design tokens `--tag-0` … `--tag-7`, quiet tints drawn from the
// brand that stay clear of every status colour (a tag is identity, not
// status). Until then they were bright hues outside the palette (Rose, Orange,
// Yellow, Lime, Emerald, Cyan, Violet, Pink), and Yellow and Rose read as the
// attention and error colours. Each slot keeps its index under a new name: 0
// is Clay (it was Rose), 7 is Heather (it was Pink). `hex` keeps its name for
// the swatches; it holds the token.

export const LIGHTING_COLOR_TAG_PALETTE = [
  { index: 0, name: "Clay", hex: "var(--tag-0)" },
  { index: 1, name: "Ochre", hex: "var(--tag-1)" },
  { index: 2, name: "Sand", hex: "var(--tag-2)" },
  { index: 3, name: "Olive", hex: "var(--tag-3)" },
  { index: 4, name: "Slate", hex: "var(--tag-4)" },
  { index: 5, name: "Mist", hex: "var(--tag-5)" },
  { index: 6, name: "Plum", hex: "var(--tag-6)" },
  { index: 7, name: "Heather", hex: "var(--tag-7)" },
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
