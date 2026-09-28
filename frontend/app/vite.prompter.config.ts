import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The prompter's window's page (`prompter.html`), built by itself into the
// same `dist`, after the operator's pages (`npm run build` runs both).
//
// A build of its own keeps the two apart. The operator's pages have one
// stylesheet in one order (`vite.config.ts`). A second page in that build
// changed the order, and the operator's keys drew otherwise: the captures
// found it on 2026-09-28. Built apart, the operator's pages come out as they
// did before there was a second page, and the prompter's stylesheet holds
// what the glass needs and nothing of the operator's.
//
// The dev server needs none of this: it serves both pages from this folder.

const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  build: {
    // The operator's pages are in `dist` already.
    emptyOutDir: false,
    cssCodeSplit: false,
    rolldownOptions: {
      input: {
        prompter: fileURLToPath(new URL("prompter.html", import.meta.url)),
      },
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
});
