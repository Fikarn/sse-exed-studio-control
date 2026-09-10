import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/") ? "vendor" : undefined;
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    // Loopback only: the dev server serves the Tauri dev shell on this
    // machine and must not listen on every interface (2026-09 production
    // readiness, Slice 1 — finding F24; guarded by
    // scripts/frontend/dev-server-host.test.mjs).
    host: "127.0.0.1",
    port: 4173,
  },
});
