import { PreReadyState } from "./PreReadyState";

// 2026-09 production readiness, Slice 14 (finding F26): what the bay shows for
// the moment between "ready" and a workspace's chunk arriving. The shell asks
// for the chunk as soon as it has drawn, so on the workstation this is rarely
// on screen at all. It has a test id of its own: a workspace's id is never on
// it, so a spec that waits for a workspace cannot mistake this for one.

export function WorkspaceLoadingSurface({ area }: { area: string }) {
  return <PreReadyState tone="info" word="OPENING…" sentence={`Opening ${area}.`} testId="workspace-loading" />;
}
