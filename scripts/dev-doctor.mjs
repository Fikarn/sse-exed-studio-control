import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const releaseMode = args.has("--release");

const results = [];

function run(command, commandArgs = []) {
  try {
    const result = spawnSync(command, commandArgs, {
      cwd: rootDir,
      encoding: "utf8",
      shell: process.platform === "win32" && /\.(bat|cmd)$/i.test(command),
      windowsHide: true,
    });

    return {
      exitCode: result.status ?? 1,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      stderr: "",
      stdout: "",
    };
  }
}

function record(status, label, detail) {
  results.push({ detail, label, status });
}

function pass(label, detail) {
  record("pass", label, detail);
}

function warn(label, detail) {
  record("warn", label, detail);
}

function fail(label, detail) {
  record("fail", label, detail);
}

function firstLine(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function checkCommand(label, command, commandArgs = ["--version"]) {
  const result = run(command, commandArgs);
  const output = firstLine(result.stdout) ?? firstLine(result.stderr);
  if (result.exitCode === 0 && output) {
    pass(label, output);
    return output;
  }

  fail(label, result.error ?? (result.stderr || `Unable to run ${command} ${commandArgs.join(" ")}`.trim()));
  return null;
}

function checkNode() {
  const version = checkCommand("Node.js", commandName("node"), ["--version"]);
  if (!version) {
    return;
  }

  const [major, minor] = version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number(part));
  if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 24) {
    fail("Node.js baseline", `Expected Node >=24; current version is ${version}.`);
    return;
  }

  if (major !== 24) {
    warn("Node.js baseline", `Node 24 LTS is the target-host baseline from .nvmrc; current version is ${version}.`);
    return;
  }

  pass("Node.js baseline", "Matches the Node 24 LTS target-host baseline.");
}

function checkPackageInstall() {
  const packageLock = existsSync(path.join(rootDir, "package-lock.json"));
  const nodeModules = existsSync(path.join(rootDir, "node_modules"));
  const tauriCli = existsSync(
    path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri")
  );

  if (!packageLock) {
    fail("npm lockfile", "package-lock.json is missing. Run npm install from the repository root.");
  } else {
    pass("npm lockfile", "package-lock.json is present.");
  }

  if (!nodeModules) {
    fail("npm install", "node_modules is missing. Run npm install from the repository root.");
  } else {
    pass("npm install", "node_modules is present.");
  }

  if (!tauriCli) {
    fail("Tauri CLI", "Local @tauri-apps/cli binary is missing. Run npm install from the repository root.");
  } else {
    pass("Tauri CLI", "Local workspace Tauri CLI is installed.");
  }
}

function checkReleaseRuntime() {
  try {
    const runtime = readJson("scripts/native-release-runtime.json");
    if (runtime.shippingRuntime !== "tauri") {
      fail("Release runtime", `Expected shippingRuntime "tauri"; found "${runtime.shippingRuntime}".`);
      return;
    }

    pass("Release runtime", "scripts/native-release-runtime.json selects the Tauri shipping runtime.");
  } catch (error) {
    fail("Release runtime", error instanceof Error ? error.message : String(error));
  }
}

function checkTauriScaffold() {
  const requiredFiles = [
    "native/tauri-shell/Cargo.toml",
    "native/tauri-shell/tauri.conf.json",
    "native/tauri-shell/src/main.rs",
    "native/tauri-shell/src/engine.rs",
  ];
  const missing = requiredFiles.filter((relativePath) => !existsSync(path.join(rootDir, relativePath)));
  if (missing.length > 0) {
    fail("Tauri scaffold", `Missing ${missing.join(", ")}.`);
    return;
  }

  pass("Tauri scaffold", "Required Tauri shell files are present.");
}

function resolveExecutable(names, envNames) {
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value && existsSync(value)) {
      return { source: envName, value };
    }
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  for (const name of names) {
    const result = run(lookupCommand, [name]);
    const output = firstLine(result.stdout);
    if (result.exitCode === 0 && output) {
      return { source: "PATH", value: output };
    }
  }

  return null;
}

function qtifwInstructions() {
  // Any QtIFW 4.x is acceptable; substitute the installed minor version.
  if (process.platform === "win32") {
    return [
      'Set $env:SSE_QT_IFW_BINARYCREATOR = "C:\\Qt\\Tools\\QtInstallerFramework\\4.11\\bin\\binarycreator.exe"',
      'Set $env:SSE_QT_IFW_REPOGEN = "C:\\Qt\\Tools\\QtInstallerFramework\\4.11\\bin\\repogen.exe"',
    ].join("\n");
  }

  return [
    "Install QtIFW into .tools/qt-ifw or another local path, then export:",
    'export SSE_QT_IFW_BINARYCREATOR="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.11/bin/binarycreator"',
    'export SSE_QT_IFW_REPOGEN="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.11/bin/repogen"',
  ].join("\n");
}

function checkQtIfw() {
  const binaryCreator = resolveExecutable(
    ["binarycreator.exe", "binarycreator"],
    ["SSE_QT_IFW_BINARYCREATOR", "QT_IFW_BINARYCREATOR"]
  );
  const repoGen = resolveExecutable(["repogen.exe", "repogen"], ["SSE_QT_IFW_REPOGEN", "QT_IFW_REPOGEN"]);

  if (binaryCreator && repoGen) {
    pass(
      "Qt Installer Framework",
      `binarycreator via ${binaryCreator.source}: ${binaryCreator.value}; repogen via ${repoGen.source}: ${repoGen.value}`
    );
    return;
  }

  const detail = `QtIFW is required for installer/update-repository release gates.\n${qtifwInstructions()}`;
  if (releaseMode) {
    fail("Qt Installer Framework", detail);
  } else {
    warn("Qt Installer Framework", detail);
  }
}

function checkGitCleanliness() {
  const result = run("git", ["status", "--short"]);
  if (result.exitCode !== 0) {
    fail("Git status", result.stderr || "Unable to read git status.");
    return;
  }

  const status = result.stdout.trim();
  if (!status) {
    pass("Git status", "Working tree is clean.");
    return;
  }

  const detail = `Working tree has local changes:\n${status}`;
  if (releaseMode) {
    fail("Git status", `${detail}\nRelease evidence should start from a clean checkout.`);
  } else {
    warn("Git status", `${detail}\nThis is acceptable during development; clean it before release evidence.`);
  }
}

function printResults() {
  for (const result of results) {
    const prefix = result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
    console.log(`${prefix} ${result.label}: ${result.detail}`);
  }

  const failCount = results.filter((result) => result.status === "fail").length;
  const warnCount = results.filter((result) => result.status === "warn").length;
  console.log("");
  console.log(
    failCount === 0
      ? `Developer doctor completed with ${warnCount} warning(s).`
      : `Developer doctor failed with ${failCount} failure(s) and ${warnCount} warning(s).`
  );

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

console.log(releaseMode ? "Running release readiness doctor..." : "Running developer readiness doctor...");
checkNode();
checkCommand("npm", commandName("npm"), ["--version"]);
checkCommand("cargo", "cargo", ["--version"]);
checkCommand("rustc", "rustc", ["--version"]);
checkPackageInstall();
checkReleaseRuntime();
checkTauriScaffold();
checkQtIfw();
checkGitCleanliness();
printResults();
