import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

export function createQualificationEvidence({ lane, rootDir }) {
  const explicitRoot = process.env.SSE_TAURI_QUALIFICATION_EVIDENCE_DIR;
  const evidenceRoot = explicitRoot
    ? path.resolve(rootDir, explicitRoot)
    : mkdtempSync(path.join(tmpdir(), `sse-tauri-${lane}-evidence-`));
  const laneRoot = explicitRoot ? path.join(evidenceRoot, lane) : evidenceRoot;
  const startedAt = new Date();
  const checks = [];

  mkdirSync(laneRoot, { recursive: true });

  return {
    recordCheck(name, details = {}) {
      checks.push({
        details,
        name,
        passedAt: new Date().toISOString(),
      });
    },
    summaryPath: path.join(laneRoot, "summary.json"),
    write(status, extra = {}) {
      const completedAt = new Date();
      const summary = {
        checks,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        githubSha: process.env.GITHUB_SHA ?? null,
        lane,
        platform: process.platform,
        startedAt: startedAt.toISOString(),
        status,
        ...extra,
      };

      writeFileSync(this.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      return this.summaryPath;
    },
  };
}
