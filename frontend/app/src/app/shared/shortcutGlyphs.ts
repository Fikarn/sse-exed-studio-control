// 2026-09 audit remediation, Slice 12 — keyboard shortcut labels follow the
// host OS. The app runs on a Windows studio workstation; every hint used to
// show the Mac glyphs (⌘ ⌥ ⇧) with "(Ctrl+K on Windows)" footnotes. Callers
// describe a shortcut with tokens ("mod", "alt", "shift", plus the key) and
// let this module render it for the platform the page is running on.

export type ShortcutToken = "mod" | "alt" | "shift" | (string & {});

interface PlatformSource {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

function currentNavigator(): PlatformSource | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as PlatformSource);
}

/** True on macOS / iOS hosts. Prefers `userAgentData.platform`, then the
 *  legacy `navigator.platform`, then the user-agent string; anything else
 *  (Windows, Linux, unknown) is treated as a Ctrl/Alt keyboard. */
export function isApplePlatform(source: PlatformSource | undefined = currentNavigator()): boolean {
  if (!source) return false;
  const platform = source.userAgentData?.platform ?? source.platform ?? "";
  if (platform) return APPLE_PLATFORM.test(platform);
  return APPLE_PLATFORM.test(source.userAgent ?? "");
}

const APPLE_LABELS: Record<string, string> = { mod: "⌘", alt: "⌥", shift: "⇧" };
const OTHER_LABELS: Record<string, string> = { mod: "Ctrl", alt: "Alt", shift: "Shift" };

/** The label for one token on the given platform ("mod" → "⌘" / "Ctrl"). */
export function shortcutKeyLabel(token: ShortcutToken, apple: boolean = isApplePlatform()): string {
  const labels = apple ? APPLE_LABELS : OTHER_LABELS;
  return labels[token] ?? token;
}

/** One label per token, for surfaces that render each key in its own <kbd>. */
export function shortcutParts(keys: readonly ShortcutToken[], apple: boolean = isApplePlatform()): string[] {
  return keys.map((key) => shortcutKeyLabel(key, apple));
}

/** A single string: Apple glyphs run together ("⌘⇧R"); everything else joins
 *  with plus signs ("Ctrl+Shift+R"). */
export function formatShortcut(keys: readonly ShortcutToken[], apple: boolean = isApplePlatform()): string {
  const parts = shortcutParts(keys, apple);
  return apple ? parts.join("") : parts.join("+");
}
