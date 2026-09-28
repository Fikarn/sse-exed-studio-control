// `npm run app`: the app as a development run, apart from the studio's.
//
// It starts `tauri dev` (the pages' dev server, a development engine and a
// development shell) with saved data of its own, the lights held and their
// wire cut, the console and the cameras simulated, and a Stream Deck bridge
// port of its own. It can run while the studio's app is open: a development
// shell has an identity of its own as well (the shell's
// `mark_as_development`).
//
// The data lives in `.dev/app-data` in the repository, which git ignores, and
// it stays between runs. `npm run app -- --data=<folder>` opens another
// folder: a copy of the studio's data, to work on that. The studio's own
// folder is refused, here and by every development build
// (`studio_control_protocol::development`).
//
// No other argument is taken: `--config` can change the app's identity, and
// what `tauri dev` hands on to the app is the app's to refuse.

import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { laneEnvRefusal } from "./native-runtime-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The bridge port of the studio's app, the one Companion talks to. */
export const STUDIO_BRIDGE_PORT = 38201;
/** The bridge port of a development run (the engine's `DEVELOPMENT_CONTROL_SURFACE_PORT`). */
export const DEVELOPMENT_BRIDGE_PORT = 38211;

/**
 * The data folder the arguments name, or null for the run's own. Any other
 * argument is refused with a sentence.
 */
export function dataFolderFrom(args) {
  let folder = null;
  for (const arg of args) {
    const named = /^--data=(.+)$/.exec(arg);
    if (!named) {
      throw new Error(
        `'${arg}' is not an argument of \`npm run app\`. It takes one, --data=<folder>: the saved data to open in place of its own.`
      );
    }
    folder = path.resolve(named[1]);
  }
  return folder;
}

/**
 * The environment of a development run: `env` with the run's own folders and
 * port, and the switches that keep it off the devices. Every one of them is
 * set here, whatever `env` holds: a variable of the same name in `env`, in
 * any case (Windows reads the names without regard to it), is left out.
 */
export function developmentEnv(env, { dataFolder = null, repositoryRoot = root } = {}) {
  const appDataDir = dataFolder ?? path.join(repositoryRoot, ".dev", "app-data");
  const own = {
    SSE_APP_DATA_DIR: appDataDir,
    SSE_LOG_DIR: path.join(appDataDir, "logs"),
    SSE_CONTROL_SURFACE_PORT: String(DEVELOPMENT_BRIDGE_PORT),
    SSE_SAFE_START: "1",
    SSE_LIGHTS_SIMULATED: "1",
    SSE_AUDIO_SIMULATED_INPUT_MODE: "1",
    SSE_CAMERAS_SIMULATED: "1",
  };
  const inherited = Object.entries(env).filter(([name]) => !Object.hasOwn(own, name.toUpperCase()));
  return { ...Object.fromEntries(inherited), ...own };
}

function main() {
  let env;
  try {
    env = developmentEnv(process.env, { dataFolder: dataFolderFrom(process.argv.slice(2)) });
    // The lanes' own check of a hardened environment. Of its rules only the
    // data folder is the caller's to get wrong: the studio's own is refused.
    const refusal = laneEnvRefusal(env, { liveConsole: false });
    if (refusal) {
      throw new Error(refusal);
    }
  } catch (error) {
    process.stderr.write(`npm run app: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(env.SSE_APP_DATA_DIR, { recursive: true });
  process.stdout.write(
    [
      "Development run",
      `  Saved data   ${env.SSE_APP_DATA_DIR}`,
      `  Bridge port  ${env.SSE_CONTROL_SURFACE_PORT} (the studio's is ${STUDIO_BRIDGE_PORT})`,
      "  Lights held and simulated, console and cameras simulated.",
      "  Setup's probes still ask the address they are given.",
      "",
    ].join("\n")
  );

  // The Tauri CLI's own entry, started with this node: no shell between, so
  // the spaces in this repository's path need no quoting.
  const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const child = spawn(process.execPath, [tauri, "dev"], {
    cwd: path.join(root, "native", "tauri-shell"),
    env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

  child.on("close", (exitCode) => {
    process.exitCode = exitCode ?? 1;
  });
}

// Runs only as `node scripts/dev-app.mjs`: an import does nothing (the run
// makes the data folder and starts `tauri dev`). The two paths are compared
// as real paths — through a directory junction or a short 8.3 name,
// `process.argv[1]` and `import.meta.url` spell the same file differently, and
// a plain comparison would skip the run without a word
// (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
