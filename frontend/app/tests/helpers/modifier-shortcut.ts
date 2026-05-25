// plan PR 4 / workstream D4: platform-aware modifier prefix for keyboard
// shortcuts. macOS uses Meta (Cmd); other platforms use Control.

export function modifierShortcut(key: string) {
  return `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;
}
