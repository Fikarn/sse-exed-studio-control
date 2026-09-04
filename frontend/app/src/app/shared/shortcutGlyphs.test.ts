import { describe, expect, it } from "vitest";

import { formatShortcut, isApplePlatform, shortcutKeyLabel, shortcutParts } from "./shortcutGlyphs";

describe("shortcutGlyphs", () => {
  it("detects Apple hosts from userAgentData, then platform, then the user agent", () => {
    expect(isApplePlatform({ userAgentData: { platform: "macOS" }, platform: "Win32", userAgent: "" })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: "Windows" }, platform: "MacIntel", userAgent: "" })).toBe(
      false
    );
    expect(isApplePlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" })).toBe(false);
    expect(isApplePlatform({ platform: "", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(
      true
    );
    expect(isApplePlatform({ platform: "Linux x86_64", userAgent: "" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });

  it("renders Windows and Linux labels as key names joined with plus signs", () => {
    expect(formatShortcut(["mod", "K"], false)).toBe("Ctrl+K");
    expect(formatShortcut(["mod", "shift", "R"], false)).toBe("Ctrl+Shift+R");
    expect(formatShortcut(["alt", "S"], false)).toBe("Alt+S");
    expect(formatShortcut(["shift", "1"], false)).toBe("Shift+1");
    expect(shortcutParts(["mod", "1–4"], false)).toEqual(["Ctrl", "1–4"]);
    expect(shortcutKeyLabel("Esc", false)).toBe("Esc");
  });

  it("keeps the Apple glyphs, run together, on macOS", () => {
    expect(formatShortcut(["mod", "K"], true)).toBe("⌘K");
    expect(formatShortcut(["mod", "shift", "R"], true)).toBe("⌘⇧R");
    expect(formatShortcut(["alt", "C"], true)).toBe("⌥C");
    expect(shortcutParts(["shift", "Drag"], true)).toEqual(["⇧", "Drag"]);
  });

  it("defaults to the platform the tests run on", () => {
    const apple = isApplePlatform();
    expect(formatShortcut(["mod", "K"])).toBe(apple ? "⌘K" : "Ctrl+K");
  });
});
