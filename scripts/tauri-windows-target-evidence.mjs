import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const defaultEvidenceBase = path.join(rootDir, "artifacts", "tauri-qualification", "windows-target-host");

function hasFlag(name) {
  return args.includes(name);
}

function readFlag(name) {
  const prefix = `${name}=`;
  const direct = args.find((value) => value.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index !== -1) {
    return args[index + 1] ?? null;
  }

  return null;
}

function printHelp() {
  console.log(`Usage:
  npm run tauri:package:win:evidence
  node scripts/tauri-windows-target-evidence.mjs [--output-dir <path>] [--allow-dirty]

Purpose:
  Run the Windows 11 x64 Tauri QtIFW package gate and write a target-host
  evidence bundle for the frontend cutover issue.

Required host:
  Windows 11 x64 with Node 20, Rust stable, npm dependencies, and QtIFW
  binarycreator/repogen available on PATH or through:
    SSE_QT_IFW_BINARYCREATOR
    SSE_QT_IFW_REPOGEN
`);
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function needsCommandShell(command) {
  return process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

function runCapture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    shell: needsCommandShell(command),
    windowsHide: true,
  });

  return {
    command,
    args: commandArgs,
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function safeCapture(command, commandArgs, options = {}) {
  try {
    return runCapture(command, commandArgs, options);
  } catch (error) {
    return {
      command,
      args: commandArgs,
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      stderr: "",
      stdout: "",
    };
  }
}

function firstOutputLine(result) {
  if (result.exitCode !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function resolvePathFromRoot(value) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function writeJson(targetPath, value) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveExecutable(names, envNames) {
  for (const envName of envNames) {
    const candidate = process.env[envName];
    if (candidate && existsSync(candidate)) {
      return {
        path: candidate,
        source: envName,
      };
    }
  }

  for (const name of names) {
    const result = safeCapture("where.exe", [name]);
    if (result.exitCode !== 0) {
      continue;
    }

    const candidate = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && existsSync(line));

    if (candidate) {
      return {
        path: candidate,
        source: "PATH",
      };
    }
  }

  return null;
}

function artifactInfo(label, artifactPath, kind = "file") {
  if (!existsSync(artifactPath)) {
    return {
      exists: false,
      kind,
      label,
      path: artifactPath,
    };
  }

  const stats = statSync(artifactPath);
  return {
    exists: true,
    kind,
    label,
    path: artifactPath,
    sizeBytes: stats.isFile() ? stats.size : null,
  };
}

function collectArtifacts() {
  return [
    artifactInfo(
      "packaged Tauri candidate manifest",
      path.join(rootDir, "release", "tauri-candidate", "windows", "candidate-manifest.json")
    ),
    artifactInfo(
      "Tauri candidate offline installer",
      path.join(
        rootDir,
        "release",
        "tauri-candidate-installer",
        "windows",
        "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-Installer.exe"
      )
    ),
    artifactInfo(
      "Tauri candidate update repository archive",
      path.join(
        rootDir,
        "release",
        "tauri-candidate-updates",
        "windows",
        "SSE-ExEd-Studio-Control-Tauri-Candidate-windows-UpdateRepository.zip"
      )
    ),
    artifactInfo(
      "Tauri candidate update repository",
      path.join(rootDir, "release", "tauri-candidate-updates", "windows", "repository"),
      "directory"
    ),
  ];
}

function readJsonIfExists(targetPath) {
  if (!existsSync(targetPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

function collectHostContext() {
  const windowsOs = safeCapture("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture | ConvertTo-Json -Compress",
  ]);
  const gitSha = safeCapture("git", ["rev-parse", "HEAD"]);
  const gitBranch = safeCapture("git", ["branch", "--show-current"]);
  const gitStatus = safeCapture("git", ["status", "--porcelain"]);

  return {
    arch: os.arch(),
    cpus: os.cpus().length,
    git: {
      branch: firstOutputLine(gitBranch),
      dirty: Boolean(gitStatus.stdout.trim()),
      sha: firstOutputLine(gitSha),
      status: gitStatus.stdout.trim(),
    },
    hostname: os.hostname(),
    os: {
      platform: process.platform,
      release: os.release(),
      version: os.version?.() ?? null,
      windows: readJsonIfExistsFromText(windowsOs.stdout),
    },
    tools: {
      cargo: firstOutputLine(safeCapture("cargo", ["--version"])),
      node: process.version,
      npm: firstOutputLine(safeCapture(commandName("npm"), ["--version"])),
      rustc: firstOutputLine(safeCapture("rustc", ["--version"])),
    },
  };
}

function readJsonIfExistsFromText(text) {
  if (!text?.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runLogged(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    const stdoutPath = path.join(options.logsDir, `${options.name}.stdout.log`);
    const stderrPath = path.join(options.logsDir, `${options.name}.stderr.log`);
    const combinedPath = path.join(options.logsDir, `${options.name}.combined.log`);
    const stdoutStream = createWriteStream(stdoutPath);
    const stderrStream = createWriteStream(stderrPath);
    const combinedStream = createWriteStream(combinedPath);

    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...options.env,
      },
      shell: needsCommandShell(command),
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      stdoutStream.write(chunk);
      combinedStream.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrStream.write(chunk);
      combinedStream.write(chunk);
    });

    child.on("error", (error) => {
      stdoutStream.end();
      stderrStream.end();
      combinedStream.end();
      reject(error);
    });

    child.on("close", (exitCode) => {
      stdoutStream.end();
      stderrStream.end();
      combinedStream.end();
      resolve({
        args: commandArgs,
        command,
        exitCode: exitCode ?? 1,
        logs: {
          combined: combinedPath,
          stderr: stderrPath,
          stdout: stdoutPath,
        },
      });
    });
  });
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  if (process.platform !== "win32") {
    throw new Error("Windows target-host evidence must be collected on Windows 11 x64. This host is not Windows.");
  }

  if (os.arch() !== "x64") {
    throw new Error(`Windows target-host evidence must be collected on x64. This host reported '${os.arch()}'.`);
  }

  const startedAt = new Date();
  const outputBase = resolvePathFromRoot(
    readFlag("--output-dir") ?? process.env.SSE_TAURI_WINDOWS_EVIDENCE_DIR ?? defaultEvidenceBase
  );
  const evidenceRoot = path.join(outputBase, timestampForPath(startedAt));
  const logsDir = path.join(evidenceRoot, "logs");
  const summaryPath = path.join(evidenceRoot, "summary.json");
  const latestSummaryPath = path.join(outputBase, "latest-summary.json");
  const allowDirty = hasFlag("--allow-dirty");

  rmSync(evidenceRoot, { force: true, recursive: true });
  mkdirSync(logsDir, { recursive: true });

  let summary = {
    allowDirty,
    artifacts: [],
    command: null,
    commands: [],
    completedAt: null,
    evidenceRoot,
    host: collectHostContext(),
    issue: "https://github.com/Fikarn/sse-exed-studio-control/issues/3",
    notes: [],
    startedAt: startedAt.toISOString(),
    status: "running",
    summaryPath,
  };

  const binaryCreator = resolveExecutable(
    ["binarycreator.exe", "binarycreator"],
    ["SSE_QT_IFW_BINARYCREATOR", "QT_IFW_BINARYCREATOR"]
  );
  const repoGen = resolveExecutable(["repogen.exe", "repogen"], ["SSE_QT_IFW_REPOGEN", "QT_IFW_REPOGEN"]);

  summary.qtifw = {
    binarycreator: binaryCreator,
    repogen: repoGen,
  };

  try {
    if (!binaryCreator || !repoGen) {
      throw new Error(
        "QtIFW binarycreator and repogen are required. Put them on PATH or set SSE_QT_IFW_BINARYCREATOR / SSE_QT_IFW_REPOGEN."
      );
    }

    if (summary.host.git.dirty && !allowDirty) {
      throw new Error(
        `Working tree is dirty before evidence collection. Commit/stash changes or rerun with --allow-dirty.\n${summary.host.git.status}`
      );
    }

    console.log(`Windows target-host evidence root: ${evidenceRoot}`);
    console.log(`Git commit: ${summary.host.git.sha}`);
    console.log("Running npm run tauri:foundation");

    const foundationCommand = await runLogged(commandName("npm"), ["run", "tauri:foundation"], {
      logsDir,
      name: "tauri-foundation",
    });
    summary.commands.push(foundationCommand);

    if (foundationCommand.exitCode !== 0) {
      summary.command = foundationCommand;
      throw new Error(`tauri:foundation exited with code ${foundationCommand.exitCode}.`);
    }

    const postFoundationStatus = safeCapture("git", ["status", "--porcelain"]);
    summary.postFoundationGitStatus = postFoundationStatus.stdout.trim();
    if (summary.postFoundationGitStatus && !allowDirty) {
      throw new Error(
        `Working tree became dirty after tauri:foundation. Generated artifacts may be stale.\n${summary.postFoundationGitStatus}`
      );
    }

    console.log("Running npm run tauri:package:win:ifw-local");

    const command = await runLogged(commandName("npm"), ["run", "tauri:package:win:ifw-local"], {
      env: {
        SSE_NATIVE_INSTALLER_ACCEPTANCE_DIR: path.join(evidenceRoot, "installer-acceptance"),
      },
      logsDir,
      name: "tauri-package-win-ifw-local",
    });

    summary.command = command;
    summary.commands.push(command);
    summary.artifacts = collectArtifacts();

    const missingArtifacts = summary.artifacts.filter((artifact) => !artifact.exists);
    if (command.exitCode !== 0) {
      throw new Error(`tauri:package:win:ifw-local exited with code ${command.exitCode}.`);
    }
    if (missingArtifacts.length > 0) {
      throw new Error(
        `Expected Windows Tauri candidate artifacts are missing: ${missingArtifacts.map((a) => a.label).join(", ")}`
      );
    }

    summary.status = "passed";
    summary.notes.push(
      "Attach this summary and the logs directory to issue #3 before claiming Windows target-host evidence."
    );
  } catch (error) {
    summary.status = "failed";
    summary.error = error instanceof Error ? error.message : String(error);
    summary.artifacts = collectArtifacts();
    throw error;
  } finally {
    summary.completedAt = new Date().toISOString();
    writeJson(summaryPath, summary);
    writeJson(latestSummaryPath, summary);
    console.log(`Windows target-host evidence summary: ${summaryPath}`);
    console.log(`Latest summary pointer: ${latestSummaryPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
