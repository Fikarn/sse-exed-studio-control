import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OperatorShell } from "./app/OperatorShell";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element.");
}

const app = <OperatorShell />;
const tauriRuntime = "__TAURI_INTERNALS__" in window;

createRoot(rootElement).render(tauriRuntime ? app : <StrictMode>{app}</StrictMode>);
