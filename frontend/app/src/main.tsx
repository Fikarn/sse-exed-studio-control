import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/jetbrains-mono/index.css";

import { OperatorShell } from "./app/OperatorShell";
import { createShellEnvironment } from "./app/createShellEnvironment";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

// 2026-09 production readiness, Slice 5 (finding F09): an error nothing caught
// — a render outside a boundary, a promise nobody awaited — reaches the
// store's background-failure ring, which the diagnostics export carries.
// Nothing here changes what the operator sees; the boundaries are Slice 9's.
const environment = createShellEnvironment();
window.addEventListener("error", (event) => {
  environment.store.reportBackgroundFailure(event.error ?? event.message, "window error");
});
window.addEventListener("unhandledrejection", (event) => {
  environment.store.reportBackgroundFailure(event.reason, "unhandled rejection");
});

const app = <OperatorShell environment={environment} />;
const tauriRuntime = "__TAURI_INTERNALS__" in window;

createRoot(rootElement).render(tauriRuntime ? app : <StrictMode>{app}</StrictMode>);
