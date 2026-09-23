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
    // 2026-09 production readiness, Slice 14 (finding F26): the workspaces are
    // chunks of their own (`src/app/workspaceChunks.ts`), and the stylesheet is
    // deliberately NOT split with them. Split styles are appended when their
    // chunk arrives, so which of two equally specific rules wins would depend
    // on which workspace the operator opened first. One stylesheet, one order.
    cssCodeSplit: false,
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
