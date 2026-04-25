import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNativeReleaseRuntime } from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const defaultEvidenceBase = path.join(rootDir, "artifacts", "native-release", "windows-target-host");

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
  return index === -1 ? null : (args[index + 1] ?? null);
}

function printHelp() {
  console.log(`Usage:
  npm run native:release:win:evidence
  node scripts/native-windows-release-evidence.mjs [--output-dir <path>] [--issue-url <url>] [--allow-dirty]

Purpose:
  Run the Windows 11 x64 switched native release gate and write a target-host
  evidence bundle for the active release/evidence issue.

Required host:
  Windows 11 x64 with Node 20, Rust stable, npm dependencies, and QtIFW
  binarycreator/repogen available on PATH or through:
    SSE_QT_IFW_BINARYCREATOR
    SSE_QT_IFW_REPOGEN

Tracking:
  Pass --issue-url or set SSE_EVIDENCE_ISSUE_URL to include the active
  release/evidence issue in summary.json.
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
    args: commandArgs,
    command,
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
      args: commandArgs,
      command,
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

function gitStatusPath(line) {
  const pathPart = line.slice(3);
  const renameSeparator = " -> ";
  return pathPart.includes(renameSeparator) ? pathPart.split(renameSeparator).pop() : pathPart;
}

function normalizeGitPath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAllowedPostReleaseDirtyLine(line) {
  const statusPath = gitStatusPath(line);
  return statusPath.startsWith("native/tauri-shell/gen/schemas/") && statusPath.endsWith(".json");
}

function isAllowedEvidenceDirtyLine(line, outputBase) {
  const outputRelativePath = normalizeGitPath(path.relative(rootDir, outputBase));
  if (!outputRelativePath || outputRelativePath.startsWith("..")) {
    return false;
  }

  const statusPath = normalizeGitPath(gitStatusPath(line));
  return (
    statusPath === outputRelativePath ||
    statusPath.startsWith(`${outputRelativePath}/`) ||
    outputRelativePath.startsWith(`${statusPath}/`)
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
      "native Windows packaged payload",
      path.join(rootDir, "release", "native", "windows", "SSE ExEd Studio Control Native"),
      "directory"
    ),
    artifactInfo(
      "native Windows packaged archive",
      path.join(rootDir, "release", "native", "windows", "SSE-ExEd-Studio-Control-Native-windows.zip")
    ),
    artifactInfo(
      "native Windows offline installer",
      path.join(
        rootDir,
        "release",
        "native-installer",
        "windows",
        "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
      )
    ),
    artifactInfo(
      "native Windows update repository archive",
      path.join(
        rootDir,
        "release",
        "native-updates",
        "windows",
        "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"
      )
    ),
    artifactInfo(
      "native Windows update repository",
      path.join(rootDir, "release", "native-updates", "windows", "repository"),
      "directory"
    ),
    artifactInfo(
      "native Windows checksum manifest",
      path.join(rootDir, "release", "checksums", "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt")
    ),
  ];
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
    throw new Error("Windows native release evidence must be collected on Windows 11 x64. This host is not Windows.");
  }

  if (os.arch() !== "x64") {
    throw new Error(`Windows native release evidence must be collected on x64. This host reported '${os.arch()}'.`);
  }

  const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
  if (releaseRuntime !== "tauri") {
    throw new Error(
      `Windows post-switch evidence must run with the Tauri release runtime. Current runtime is '${releaseRuntime}'.`
    );
  }

  const startedAt = new Date();
  const outputBase = resolvePathFromRoot(
    readFlag("--output-dir") ?? process.env.SSE_NATIVE_WINDOWS_EVIDENCE_DIR ?? defaultEvidenceBase
  );
  const evidenceRoot = path.join(outputBase, timestampForPath(startedAt));
  const logsDir = path.join(evidenceRoot, "logs");
  const summaryPath = path.join(evidenceRoot, "summary.json");
  const latestSummaryPath = path.join(outputBase, "latest-summary.json");
  const allowDirty = hasFlag("--allow-dirty");
  const issueUrl = readFlag("--issue-url") ?? process.env.SSE_EVIDENCE_ISSUE_URL ?? null;

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
    issue: issueUrl,
    notes: [],
    releaseRuntime,
    releaseRuntimeConfig: readJsonIfExists(path.join(rootDir, "scripts", "native-release-runtime.json")),
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

    console.log(`Windows native release evidence root: ${evidenceRoot}`);
    console.log(`Git commit: ${summary.host.git.sha}`);
    console.log("Running npm run native:release:win:local");

    const command = await runLogged(commandName("npm"), ["run", "native:release:win:local"], {
      env: {
        SSE_NATIVE_BRIDGE_ACCEPTANCE_DIR: path.join(evidenceRoot, "bridge-acceptance"),
        SSE_NATIVE_DELIVERY_ACCEPTANCE_DIR: path.join(evidenceRoot, "delivery-acceptance"),
        SSE_NATIVE_INSTALLER_ACCEPTANCE_DIR: path.join(evidenceRoot, "installer-acceptance"),
        SSE_NATIVE_PACKAGED_ACCEPTANCE_DIR: path.join(evidenceRoot, "packaged-acceptance"),
      },
      logsDir,
      name: "native-release-win-local",
    });

    summary.command = command;
    summary.commands.push(command);
    summary.artifacts = collectArtifacts();

    const postReleaseStatus = safeCapture("git", ["status", "--porcelain"]);
    const postReleaseStatusLines = postReleaseStatus.stdout.split(/\r?\n/).filter(Boolean);
    const allowedPostReleaseStatusLines = postReleaseStatusLines.filter(
      (line) => isAllowedPostReleaseDirtyLine(line) || isAllowedEvidenceDirtyLine(line, outputBase)
    );
    const unexpectedPostReleaseStatusLines = postReleaseStatusLines.filter(
      (line) => !isAllowedPostReleaseDirtyLine(line) && !isAllowedEvidenceDirtyLine(line, outputBase)
    );
    summary.postReleaseAllowedGitStatus = allowedPostReleaseStatusLines.join("\n");
    summary.postReleaseGitStatus = postReleaseStatusLines.join("\n");
    summary.postReleaseUnexpectedGitStatus = unexpectedPostReleaseStatusLines.join("\n");

    if (allowedPostReleaseStatusLines.length > 0) {
      summary.notes.push(
        "native:release:win:local generated platform-specific Tauri schema files and/or target-host evidence files; these were recorded and allowed."
      );
    }

    if (command.exitCode !== 0) {
      throw new Error(`native:release:win:local exited with code ${command.exitCode}.`);
    }

    const missingArtifacts = summary.artifacts.filter((artifact) => !artifact.exists);
    if (missingArtifacts.length > 0) {
      throw new Error(
        `Expected Windows native release artifacts are missing: ${missingArtifacts.map((a) => a.label).join(", ")}`
      );
    }

    if (unexpectedPostReleaseStatusLines.length > 0 && !allowDirty) {
      throw new Error(
        `Working tree became dirty outside allowed Tauri schema generation after native:release:win:local.\n${summary.postReleaseUnexpectedGitStatus}`
      );
    }

    summary.status = "passed";
    summary.notes.push(
      issueUrl
        ? `Attach this summary and the logs directory to ${issueUrl} before claiming Windows post-switch target-host evidence.`
        : "Attach this summary and the logs directory to the active release/evidence issue before claiming Windows post-switch target-host evidence."
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
    console.log(`Windows native release evidence summary: ${summaryPath}`);
    console.log(`Latest summary pointer: ${latestSummaryPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
