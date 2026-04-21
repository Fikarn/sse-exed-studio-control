import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeBuildScript = path.join(rootDir, "scripts", "native-build.mjs");
const outputRootName = process.argv.includes("--onscreen") ? "native-onscreen" : "native";
const outputRoot = path.join(rootDir, "artifacts", "parity", outputRootName);

const sceneArg = process.argv.find((value) => value.startsWith("--scene="));
const resolutionArg = process.argv.find((value) => value.startsWith("--resolution="));
const onscreenMode = process.argv.includes("--onscreen");

const sceneFilter = sceneArg ? sceneArg.slice("--scene=".length) : null;
const resolutionFilter = resolutionArg ? resolutionArg.slice("--resolution=".length) : null;

const scenes = [
  { name: "dashboard-idle", engine: false },
  { name: "planning-populated", engine: false },
  { name: "planning-empty", engine: false },
  { name: "project-detail-open", engine: false },
  { name: "time-report-open", engine: false },
  { name: "shortcuts-open", engine: false },
  { name: "about-open", engine: false },
  { name: "setup-required", engine: false },
  { name: "setup-control-selected", engine: false },
  { name: "setup-control-page-nav", engine: false },
  { name: "setup-control-dial-selected", engine: false },
  { name: "setup-runner-verify-live", engine: false },
  { name: "setup-support-ready", engine: false },
  { name: "setup-support-empty", engine: false },
  { name: "audio-populated", engine: true },
  { name: "lighting-populated", engine: true },
  { name: "setup-ready", engine: true },
];

const resolutions = [
  { name: "workstation", width: 2560, height: 1440 },
  { name: "minimum", width: 1280, height: 800 },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveShellExecutable() {
  const candidates =
    process.platform === "darwin"
      ? [
          path.join(
            rootDir,
            "native",
            "build",
            "qt-shell",
            "sse_exed_native.app",
            "Contents",
            "MacOS",
            "sse_exed_native"
          ),
        ]
      : process.platform === "win32"
        ? [
            path.join(rootDir, "native", "build", "qt-shell", "sse_exed_native.exe"),
            path.join(rootDir, "native", "build", "qt-shell", "Debug", "sse_exed_native.exe"),
            path.join(rootDir, "native", "build", "qt-shell", "Release", "sse_exed_native.exe"),
            path.join(rootDir, "native", "build", "sse_exed_native.exe"),
          ]
        : [
            path.join(rootDir, "native", "build", "qt-shell", "sse_exed_native"),
            path.join(rootDir, "native", "build", "sse_exed_native"),
          ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

run("node", [nativeBuildScript]);

const shellExecutable = resolveShellExecutable();
if (!shellExecutable) {
  console.error("Native shell executable not found after build.");
  process.exit(1);
}

const selectedScenes = sceneFilter ? scenes.filter((scene) => scene.name === sceneFilter) : scenes;
const selectedResolutions = resolutionFilter
  ? resolutions.filter((entry) => entry.name === resolutionFilter)
  : resolutions;

if (selectedScenes.length === 0) {
  console.error(`Unknown scene '${sceneFilter}'.`);
  process.exit(1);
}

if (selectedResolutions.length === 0) {
  console.error(`Unknown resolution '${resolutionFilter}'.`);
  process.exit(1);
}

for (const resolution of selectedResolutions) {
  const resolutionDir = path.join(outputRoot, resolution.name);
  mkdirSync(resolutionDir, { recursive: true });

  for (const scene of selectedScenes) {
    const outputPath = path.join(resolutionDir, `${scene.name}.png`);
    const mode = scene.engine ? "engine" : "stub";
    console.log(`[native-parity] Capturing ${scene.name} (${mode}) at ${resolution.name} -> ${outputPath}`);

    const shellArgs = [
      "--parity-capture-scene",
      scene.name,
      "--parity-capture-output",
      outputPath,
      "--parity-capture-width",
      String(resolution.width),
      "--parity-capture-height",
      String(resolution.height),
    ];

    if (scene.engine) {
      shellArgs.push("--parity-capture-engine");
    }

    const offscreenPlatform = `offscreen:size=${resolution.width}x${resolution.height}`;
    const captureEnv = {
      QML_DISABLE_DISK_CACHE: "1",
      QT_QUICK_CONTROLS_STYLE: "Basic",
    };

    if (onscreenMode) {
      if (process.env.QT_QPA_PLATFORM) {
        captureEnv.QT_QPA_PLATFORM = process.env.QT_QPA_PLATFORM;
      }
    } else {
      captureEnv.QT_QPA_PLATFORM = process.env.QT_QPA_PLATFORM ?? offscreenPlatform;
      captureEnv.QT_QPA_OFFSCREEN_VIRTUAL_SCREEN_SIZE = `${resolution.width}x${resolution.height}`;
    }

    run(shellExecutable, shellArgs, {
      env: captureEnv,
    });
  }
}

console.log(`[native-parity] Wrote captures to ${outputRoot}`);
