import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const viteScript = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const args = process.argv.slice(2);
const previewPort = Number(readFlag("--port") ?? "4173");
const outputRoot = path.resolve(rootDir, readFlag("--out") ?? "artifacts/visual/tauri-cutover");
const fixtures = readListFlag("--fixtures", [
  "setup-ready",
  "protocol-mismatch",
  "lighting-populated",
  "audio-populated",
  "planning-populated",
]);
const sizes = readSizeFlag("--sizes", [
  { height: 1080, label: "1920x1080", width: 1920 },
  { height: 1440, label: "2560x1440", width: 2560 },
]);

function needsCommandShell(command) {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = args.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function readListFlag(name, fallback) {
  const raw = readFlag(name);
  if (!raw) {
    return fallback;
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readSizeFlag(name, fallback) {
  const entries = readListFlag(name, []);
  if (entries.length === 0) {
    return fallback;
  }

  return entries.map((entry) => {
    const [width, height] = entry.split("x").map((value) => Number(value.trim()));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`Invalid visual review size '${entry}'. Use WIDTHxHEIGHT, for example 1920x1080.`);
    }
    return {
      height,
      label: `${width}x${height}`,
      width,
    };
  });
}

function resolveGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    shell: needsCommandShell(command),
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

async function assertTcpPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(
        new Error(
          `Tauri visual review requires 127.0.0.1:${port}, but the port preflight failed (${error.code ?? "unknown"}: ${error.message}). Stop the stale dev/preview server and rerun.`
        )
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(resolve);
    });
  });
}

function launchPreview(port) {
  const child = spawn(
    process.execPath,
    [viteScript, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: path.join(rootDir, "frontend/app"),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[visual-preview stdout] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[visual-preview stderr] ${chunk}`);
  });

  return child;
}

async function waitForPreview(child, port) {
  const deadline = Date.now() + 30_000;
  const url = `http://127.0.0.1:${port}/`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Vite preview binds.
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for visual review preview at ${url}.`);
}

async function closePreview(child) {
  if (child.exitCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else if (child.pid) {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
      throw error;
    }
    return;
  }

  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await delay(100);
  }

  if (child.exitCode === null) {
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else if (child.pid) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
        throw error;
      }
    }
  }
}

async function captureFixture({ browser, fixture, port, size }) {
  const context = await browser.newContext({
    timezoneId: "Europe/Stockholm",
    viewport: {
      height: size.height,
      width: size.width,
    },
  });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/?fixture=${fixture}&transport=fixture`;

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const metrics = await page.evaluate(() => ({
    bodyScrollHeight: document.body?.scrollHeight ?? 0,
    bodyScrollWidth: document.body?.scrollWidth ?? 0,
    docClientHeight: document.documentElement.clientHeight,
    docClientWidth: document.documentElement.clientWidth,
    docScrollHeight: document.documentElement.scrollHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    overflowX: getComputedStyle(document.documentElement).overflowX,
    overflowY: getComputedStyle(document.documentElement).overflowY,
  }));
  const file = path.join(outputRoot, `${fixture}-${size.label}.png`);

  await page.screenshot({ path: file });
  await context.close();

  return {
    file,
    fixture,
    fitsViewport:
      metrics.docScrollWidth <= metrics.innerWidth &&
      metrics.docScrollHeight <= metrics.innerHeight &&
      metrics.bodyScrollWidth <= metrics.innerWidth &&
      metrics.bodyScrollHeight <= metrics.innerHeight,
    metrics,
    size: size.label,
  };
}

async function main() {
  mkdirSync(outputRoot, { recursive: true });

  run(npmCommand, ["run", "build", "--workspace", "frontend/app"]);
  await assertTcpPortAvailable(previewPort);

  const preview = launchPreview(previewPort);

  try {
    await waitForPreview(preview, previewPort);

    const browser = await chromium.launch();
    const results = [];
    for (const size of sizes) {
      for (const fixture of fixtures) {
        results.push(await captureFixture({ browser, fixture, port: previewPort, size }));
      }
    }
    await browser.close();

    const summary = {
      capturedAt: new Date().toISOString(),
      fixtures,
      githubSha: resolveGitSha(),
      outputRoot,
      results,
      sizes: sizes.map((size) => size.label),
      source: "Vite preview fixture transport",
    };
    const summaryPath = path.join(outputRoot, "fixture-viewport-summary.json");
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    const failures = results.filter((entry) => !entry.fitsViewport);
    console.log(
      JSON.stringify(
        {
          failures,
          outputRoot,
          screenshots: results.length,
          summaryPath,
        },
        null,
        2
      )
    );

    if (failures.length > 0) {
      throw new Error(`Tauri visual review found ${failures.length} viewport fit failure(s).`);
    }
  } finally {
    await closePreview(preview);
  }
}

await main();
