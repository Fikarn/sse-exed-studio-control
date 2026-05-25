// plan PR 4 / workstream D4: shared Window declarations used by every spec
// that asserts engine-request counts, render counts, or native-dialog
// counts surfaced by the test bridge. Kept as an ambient `.d.ts` (no
// `export {}`) so the declarations are visible to every spec file
// without an explicit import.

interface Window {
  __SSE_TEST_ENGINE_REQUEST_COUNTS__?: Record<string, number>;
  __SSE_TEST_RENDER_COUNTS__?: {
    audioInspector?: number;
    audioRail?: number;
    audioSignalCanvas?: number;
    audioWorkspace?: number;
  };
  __SSE_TEST_NATIVE_DIALOG_COUNTS__?: {
    confirm: number;
    prompt: number;
  };
}
