import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/jetbrains-mono/index.css";

import { OperatorShell } from "./app/OperatorShell";
import { createShellEnvironment } from "./app/createShellEnvironment";
import { reportUiFailure } from "./app/startup/reportUiFailure";
import { ShellErrorBoundary } from "./app/startup/ShellErrorBoundary";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

// 2026-09 production readiness, Slice 5 (finding F09): an error nothing caught
// — a render outside a boundary, a promise nobody awaited — reaches the
// store's background-failure ring, which the diagnostics export carries.
// Slice 9 (finding F10) adds the boundaries: the root one here, the
// per-workspace one inside the shell. Both record through `reportUiFailure`,
// as these listeners do, so an error React also reports to the window is
// kept once.
const environment = createShellEnvironment();
window.addEventListener("error", (event) => {
  reportUiFailure(environment.store, event.error ?? event.message, "window error");
});
window.addEventListener("unhandledrejection", (event) => {
  reportUiFailure(environment.store, event.reason, "unhandled rejection");
});

const app = (
  <ShellErrorBoundary
    onError={(error) => reportUiFailure(environment.store, error, "screen error")}
    collectDiagnostics={() => JSON.parse(JSON.stringify(environment.store.getSnapshot()))}
  >
    <OperatorShell environment={environment} />
  </ShellErrorBoundary>
);
const tauriRuntime = "__TAURI_INTERNALS__" in window;

createRoot(rootElement).render(tauriRuntime ? app : <StrictMode>{app}</StrictMode>);
