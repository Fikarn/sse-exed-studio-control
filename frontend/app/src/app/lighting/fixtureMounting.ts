export type FixtureMounting = "grid-panel" | "grid-soft" | "stand" | "wall-bar";

export function deriveMounting(fixtureType: string): FixtureMounting {
  const t = fixtureType.trim().toLowerCase();
  if (t.includes("apollo")) return "grid-panel";
  if (t.includes("infinimat")) return "grid-soft";
  if (t.includes("infinibar")) return "wall-bar";
  if (t.includes("astra")) return "stand";
  return "stand";
}
