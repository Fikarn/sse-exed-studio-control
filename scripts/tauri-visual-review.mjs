import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
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
  { height: 800, label: "1280x800", width: 1280 },
  { height: 900, label: "1440x900", width: 1440 },
  { height: 960, label: "1600x960", width: 1600 },
  { height: 1117, label: "1728x1117", width: 1728 },
  { height: 1080, label: "1920x1080", width: 1920 },
  { height: 1440, label: "2560x1440", width: 2560 },
]);
const studioPreviewFixtures = readListFlag(
  "--studio-preview-fixtures",
  fixtures.filter((fixture) => ["audio-populated", "audio-selected-channel"].includes(fixture))
);
const studioPreviewHostSizes = readSizeFlag("--studio-preview-host-sizes", [
  { height: 982, label: "1512x982", width: 1512 },
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

function expectedLayoutMode(size) {
  if (size.width >= 1920 && size.height >= 1080) return "studioFull";
  if (size.width >= 1440 && size.height >= 900) return "desktopCompact";
  if (size.width >= 1280 && size.height >= 800) return "narrowUtility";
  return "constrained";
}

function prepareOutputRoot() {
  mkdirSync(outputRoot, { recursive: true });
  for (const entry of readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "fixture-viewport-summary.json" || entry.name.endsWith(".png")) {
      unlinkSync(path.join(outputRoot, entry.name));
    }
  }
}

function assertShellWindowRecovery() {
  const manifestPath = path.join(rootDir, "native/Cargo.toml");
  const cargoArgs = [
    "test",
    "--manifest-path",
    manifestPath,
    "--package",
    "sse-exed-tauri-shell",
    "--quiet",
    "shell_window_preferences",
  ];
  run("cargo", cargoArgs);
  return {
    assertion: "Rust unit coverage exercises stale saved-monitor fallback and monitor identity matching",
    fallback: "centered 1600x960 windowed layout when a saved monitor cannot be matched",
    source: `cargo ${cargoArgs.map((value) => (value === manifestPath ? "native/Cargo.toml" : value)).join(" ")}`,
  };
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

async function captureFixture({ browser, fixture, port, reviewSurface = "native", size }) {
  const context = await browser.newContext({
    timezoneId: "Europe/Stockholm",
    viewport: {
      height: size.height,
      width: size.width,
    },
  });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${port}/?fixture=${fixture}&transport=fixture${
    reviewSurface === "studioPreview" ? "&operatorReview=studio" : ""
  }`;

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const responsiveAssertions =
    fixture === "lighting-populated" && reviewSurface === "native"
      ? await assertLightingResponsive({ page, size })
      : null;
  const studioPreviewAssertions =
    reviewSurface === "studioPreview" ? await assertStudioPreviewFidelity({ fixture, page, size }) : null;

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
  const file =
    reviewSurface === "studioPreview"
      ? path.join(outputRoot, `${fixture}-studio-preview-${size.label}.png`)
      : path.join(outputRoot, `${fixture}-${size.label}.png`);

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
    responsiveAssertions,
    reviewSurface,
    size: size.label,
    studioPreviewAssertions,
  };
}

async function assertLightingResponsive({ page, size }) {
  const expectedMode = expectedLayoutMode(size);
  const details = await page.evaluate(() => {
    const root = document.querySelector("[data-operator-layout-root]");
    const stage = document.querySelector('[data-testid="lighting-stage"]');
    const primaryControls = Array.from(document.querySelectorAll("[data-toolbar-primary]"));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return {
      devicePixelRatio: window.devicePixelRatio,
      layoutMode: root?.dataset.layoutMode ?? null,
      primaryControls: primaryControls.map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          id: control.dataset.toolbarPrimary ?? "unknown",
          fits:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= -1 &&
            rect.top >= -1 &&
            rect.right <= viewportWidth + 1 &&
            rect.bottom <= viewportHeight + 1,
        };
      }),
      stage: stage
        ? {
            height: stage.getBoundingClientRect().height,
            width: stage.getBoundingClientRect().width,
          }
        : null,
    };
  });

  if (details.layoutMode !== expectedMode) {
    throw new Error(
      `Lighting layout mode mismatch at ${size.label}: expected ${expectedMode}, got ${details.layoutMode ?? "missing"}.`
    );
  }

  const primaryIds = details.primaryControls.map((entry) => entry.id).sort();
  const expectedPrimaryIds = ["add", "overflow", "patch", "preview", "search", "status", "title"];
  if (JSON.stringify(primaryIds) !== JSON.stringify(expectedPrimaryIds)) {
    throw new Error(`Lighting toolbar primary controls mismatch at ${size.label}: ${primaryIds.join(", ")}`);
  }

  const clipped = details.primaryControls.filter((entry) => !entry.fits);
  if (clipped.length > 0) {
    throw new Error(
      `Lighting toolbar primary controls clipped at ${size.label}: ${clipped.map((entry) => entry.id).join(", ")}`
    );
  }

  const stageMinWidth = expectedMode === "narrowUtility" ? 520 : 560;
  const stageMinHeight = expectedMode === "narrowUtility" ? 400 : 440;
  if (!details.stage || details.stage.width < stageMinWidth || details.stage.height < stageMinHeight) {
    throw new Error(
      `Lighting stage collapsed at ${size.label}: ${details.stage ? `${details.stage.width}x${details.stage.height}` : "missing"}.`
    );
  }

  if (expectedMode !== "studioFull") {
    await page.locator('[data-testid="lighting-toolbar-overflow"]').click();
    const menuLabels = await page.locator('[role="menuitem"]').allTextContents();
    for (const label of ["Highlight selection", "Solo selection", "Find selected fixtures"]) {
      if (!menuLabels.some((entry) => entry.includes(label))) {
        throw new Error(`Lighting overflow missing '${label}' at ${size.label}.`);
      }
    }
    await page.keyboard.press("Escape");
  }

  if (expectedMode === "narrowUtility") {
    const drawer = page.locator('[data-testid="lighting-inspector-drawer"]');
    if ((await drawer.count()) !== 0) {
      throw new Error(`Lighting inspector drawer should start closed at ${size.label}.`);
    }
    await page.locator('[data-testid="lighting-open-inspector"]').click();
    await drawer.waitFor({ state: "visible" });
    if (!(await drawer.getByLabel("Fixture intensity").isVisible())) {
      throw new Error(`Lighting inspector drawer did not expose selected fixture controls at ${size.label}.`);
    }
    await drawer.getByRole("button", { name: "Close" }).click();
    await drawer.waitFor({ state: "detached" });
  }

  return {
    devicePixelRatio: details.devicePixelRatio,
    layoutMode: details.layoutMode,
    primaryControls: primaryIds,
    stage: details.stage,
  };
}

async function assertDprIndependentLightingMode({ browser, port }) {
  const modes = [];
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({
      deviceScaleFactor,
      timezoneId: "Europe/Stockholm",
      viewport: { height: 900, width: 1440 },
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/?fixture=lighting-populated&transport=fixture`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(250);
    const mode = await page.locator("[data-operator-layout-root]").getAttribute("data-layout-mode");
    modes.push({ deviceScaleFactor, mode });
    await context.close();
  }
  if (!modes.every((entry) => entry.mode === "desktopCompact")) {
    throw new Error(`Layout mode must follow CSS viewport size, not devicePixelRatio: ${JSON.stringify(modes)}`);
  }
  return modes;
}

function assertRatioClose({ actual, expected, label, tolerance = 0.06 }) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} aspect ratio mismatch: expected ${expected.toFixed(3)}, got ${actual}.`);
  }
}

async function assertStudioPreviewFidelity({ fixture, page, size }) {
  const details = await page.evaluate(() => {
    const root = document.querySelector("[data-operator-layout-root]");
    const displayFor = (selector) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).display : null;
    };
    const ratioFor = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return rect.height > 0 ? rect.width / rect.height : null;
    };
    const compactPreampPanels = Array.from(
      document.querySelectorAll('[data-testid="audio-workspace"] img[class*="preampPanel"]')
    )
      .filter((image) => image.currentSrc.includes("preamp-panel-compact"))
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          naturalRatio: image.naturalWidth / Math.max(1, image.naturalHeight),
          renderedRatio: ratioFor(image),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        };
      });

    return {
      canvasBarLabelDisplay: displayFor("[class*=canvasBarLabel]"),
      canvasSelectedMetaDisplay: displayFor("[class*=canvasSelectedMeta]"),
      compactPreampPanels,
      root: root
        ? {
            layoutHeight: root.getAttribute("data-layout-height"),
            layoutMode: root.getAttribute("data-layout-mode"),
            layoutWidth: root.getAttribute("data-layout-width"),
            reviewScale: root.getAttribute("data-review-scale"),
            reviewSurface: root.getAttribute("data-review-surface"),
          }
        : null,
    };
  });

  if (details.root?.reviewSurface !== "studioPreview") {
    throw new Error(`Studio Preview expected review surface at ${size.label}, got ${details.root?.reviewSurface}.`);
  }
  if (details.root?.layoutMode !== "studioFull") {
    throw new Error(`Studio Preview expected studioFull at ${size.label}, got ${details.root?.layoutMode}.`);
  }
  if (details.root?.layoutWidth !== "2560" || details.root?.layoutHeight !== "1440") {
    throw new Error(
      `Studio Preview expected simulated 2560x1440 at ${size.label}, got ${details.root?.layoutWidth}x${details.root?.layoutHeight}.`
    );
  }

  if (fixture.startsWith("audio-")) {
    if (details.canvasBarLabelDisplay === "none" || details.canvasSelectedMetaDisplay === "none") {
      throw new Error(`Audio Studio Preview is using compact canvas metadata at ${size.label}.`);
    }
    if (details.compactPreampPanels.length === 0) {
      throw new Error(`Audio Studio Preview did not render compact preamp panels at ${size.label}.`);
    }
    for (const [index, panel] of details.compactPreampPanels.entries()) {
      assertRatioClose({
        actual: panel.renderedRatio,
        expected: panel.naturalRatio,
        label: `Audio Studio Preview compact preamp panel ${index + 1} at ${size.label}`,
      });
    }
  }

  return details;
}

async function main() {
  prepareOutputRoot();

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
    for (const size of studioPreviewHostSizes) {
      for (const fixture of studioPreviewFixtures) {
        results.push(
          await captureFixture({
            browser,
            fixture,
            port: previewPort,
            reviewSurface: "studioPreview",
            size,
          })
        );
      }
    }
    const dprLayoutCheck = await assertDprIndependentLightingMode({ browser, port: previewPort });
    await browser.close();
    const shellWindowRecovery = assertShellWindowRecovery();

    const summary = {
      capturedAt: new Date().toISOString(),
      dprLayoutCheck,
      fixtures,
      githubSha: resolveGitSha(),
      outputRoot,
      results,
      shellWindowRecovery,
      sizes: sizes.map((size) => size.label),
      studioPreviewFixtures,
      studioPreviewHostSizes: studioPreviewHostSizes.map((size) => size.label),
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
