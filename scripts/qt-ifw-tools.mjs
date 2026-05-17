import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

function firstLine(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function defaultPathLookup(name) {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookupCommand, [name], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return firstLine(result.stdout) ?? null;
}

function resolveEnvExecutable(envNames, env) {
  for (const envName of envNames) {
    const value = env[envName];
    if (value && existsSync(value)) {
      return { source: envName, value };
    }
  }
  return null;
}

function resolvePathExecutable(names, pathLookup) {
  for (const name of names) {
    const value = pathLookup(name);
    if (value) {
      return { source: "PATH", value };
    }
  }
  return null;
}

function resolveLocalQtIfw(rootDir, names) {
  const baseDir = path.join(rootDir, ".tools", "qt-ifw", "Tools", "QtInstallerFramework");
  if (!existsSync(baseDir)) {
    return null;
  }

  const versions = readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

  for (const version of versions) {
    for (const name of names) {
      const candidate = path.join(baseDir, version, "bin", name);
      if (existsSync(candidate)) {
        return { source: `.tools/qt-ifw ${version}`, value: candidate };
      }
    }
  }

  return null;
}

function resolveQtIfwExecutable({ env, envNames, names, pathLookup, rootDir }) {
  return (
    resolveEnvExecutable(envNames, env) ?? resolvePathExecutable(names, pathLookup) ?? resolveLocalQtIfw(rootDir, names)
  );
}

export function resolveQtIfwTools({ rootDir = process.cwd(), env = process.env, pathLookup = defaultPathLookup } = {}) {
  const binaryCreator = resolveQtIfwExecutable({
    env,
    envNames: ["SSE_QT_IFW_BINARYCREATOR", "QT_IFW_BINARYCREATOR"],
    names: ["binarycreator.exe", "binarycreator"],
    pathLookup,
    rootDir,
  });
  const repoGen = resolveQtIfwExecutable({
    env,
    envNames: ["SSE_QT_IFW_REPOGEN", "QT_IFW_REPOGEN"],
    names: ["repogen.exe", "repogen"],
    pathLookup,
    rootDir,
  });

  return {
    binaryCreator,
    complete: Boolean(binaryCreator && repoGen),
    repoGen,
  };
}

export function formatQtIfwToolSummary(tools) {
  if (!tools.binaryCreator || !tools.repoGen) {
    return "QtIFW tools not found.";
  }

  return `binarycreator via ${tools.binaryCreator.source}: ${tools.binaryCreator.value}; repogen via ${tools.repoGen.source}: ${tools.repoGen.value}`;
}

export function qtifwInstructions(platform = process.platform) {
  if (platform === "win32") {
    return [
      'Set $env:SSE_QT_IFW_BINARYCREATOR = "C:\\Qt\\Tools\\QtInstallerFramework\\4.11\\bin\\binarycreator.exe"',
      'Set $env:SSE_QT_IFW_REPOGEN = "C:\\Qt\\Tools\\QtInstallerFramework\\4.11\\bin\\repogen.exe"',
    ].join("\n");
  }

  return [
    "Install QtIFW into .tools/qt-ifw or another local path, then export:",
    'export SSE_QT_IFW_BINARYCREATOR="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/binarycreator"',
    'export SSE_QT_IFW_REPOGEN="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/repogen"',
  ].join("\n");
}
