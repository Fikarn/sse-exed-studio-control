import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: options.captureOutput ? "utf8" : undefined,
    stdio: options.captureOutput ? "pipe" : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    if (options.captureOutput) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function resolveExecutableOnPath(name) {
  const result = spawnSync("where", [name], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
}

function resolveSigntool() {
  const configured = process.env.SSE_WINDOWS_SIGNTOOL_PATH?.trim();
  if (configured) {
    assert(existsSync(configured), `Configured signtool path does not exist: ${configured}`);
    return configured;
  }

  const discovered = resolveExecutableOnPath("signtool");
  assert(discovered, "signtool was not found. Set SSE_WINDOWS_SIGNTOOL_PATH or install the Windows SDK.");
  return discovered;
}

function resolveCertificate() {
  const certificatePath = process.env.SSE_WINDOWS_SIGN_CERT_PATH?.trim();
  if (certificatePath) {
    assert(existsSync(certificatePath), `Signing certificate not found at ${certificatePath}.`);
    return {
      path: certificatePath,
      cleanup: null,
    };
  }

  const certificateBase64 = process.env.SSE_WINDOWS_SIGN_CERT_BASE64?.trim();
  assert(certificateBase64, "Windows signing is enabled, but no certificate path or base64 certificate was provided.");

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "sse-native-sign-windows-"));
  const certificateFilePath = path.join(tempDir, "native-release-signing-cert.pfx");
  const certificateBytes = Buffer.from(certificateBase64.replace(/\s+/g, ""), "base64");
  assert(certificateBytes.length > 0, "Decoded Windows signing certificate is empty.");
  writeFileSync(certificateFilePath, certificateBytes);
  return {
    path: certificateFilePath,
    cleanup: () => rmSync(tempDir, { force: true, recursive: true }),
  };
}

function archiveWindowsDirectory(sourceDir, archivePath) {
  rmSync(archivePath, { force: true, recursive: true });
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path @('${sourceDir.replaceAll("'", "''")}') -DestinationPath '${archivePath.replaceAll("'", "''")}' -Force`,
  ]);
}

function signFile(signtoolPath, certificatePath, certificatePassword, timestampUrl, targetPath) {
  assert(existsSync(targetPath), `Signing target not found at ${targetPath}.`);

  const signArgs = [
    "sign",
    "/fd",
    "SHA256",
    "/f",
    certificatePath,
    "/p",
    certificatePassword,
    "/d",
    releaseIdentity.displayName,
    "/du",
    releaseIdentity.productUrl,
  ];

  if (timestampUrl) {
    signArgs.push("/td", "SHA256", "/tr", timestampUrl);
  }

  signArgs.push(targetPath);

  run(signtoolPath, signArgs);
  run(signtoolPath, ["verify", "/pa", targetPath]);
}

function main() {
  // `--bundle-only` signs the packaged shell and engine, rebuilds the bundle
  // archive and stops: the release-evidence workflow runs where QtIFW is not
  // installed, so there is no installer to rebuild or sign there (production
  // readiness 2026-09, Slice 12). Without the flag nothing changes.
  const bundleOnly = process.argv.slice(2).includes("--bundle-only");

  const hasCertificatePath = Boolean(process.env.SSE_WINDOWS_SIGN_CERT_PATH?.trim());
  const hasCertificateBase64 = Boolean(process.env.SSE_WINDOWS_SIGN_CERT_BASE64?.trim());

  if (!hasCertificatePath && !hasCertificateBase64) {
    console.log(
      "Skipping native Windows signing because no signing certificate is configured (SSE_WINDOWS_SIGN_CERT_PATH or SSE_WINDOWS_SIGN_CERT_BASE64)."
    );
    process.exit(0);
  }

  assert(process.platform === "win32", "native-sign-windows.mjs can only run on Windows when signing is enabled.");

  const certificatePassword = process.env.SSE_WINDOWS_SIGN_CERT_PASSWORD?.trim();
  assert(certificatePassword, "SSE_WINDOWS_SIGN_CERT_PASSWORD is required when Windows signing is enabled.");

  const timestampUrl = process.env.SSE_WINDOWS_SIGN_TIMESTAMP_URL?.trim();
  const signtoolPath = resolveSigntool();
  const certificate = resolveCertificate();

  const packagedDirPath = path.join(rootDir, "release", "native", "windows", releaseIdentity.payloadNames.windows);
  const packagedArchivePath = path.join(
    rootDir,
    "release",
    "native",
    "windows",
    "SSE-ExEd-Studio-Control-Native-windows.zip"
  );
  const packagedShellPath = path.join(packagedDirPath, "sse-exed-tauri-shell.exe");
  const packagedEnginePath = path.join(packagedDirPath, "studio-control-engine.exe");
  const installerPath = path.join(
    rootDir,
    "release",
    "native-installer",
    "windows",
    "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"
  );

  assert(
    existsSync(packagedDirPath),
    `Packaged Windows bundle not found at ${packagedDirPath}. Run npm run native:release:win:local first.`
  );

  try {
    console.log(`Signing packaged shell: ${packagedShellPath}`);
    signFile(signtoolPath, certificate.path, certificatePassword, timestampUrl, packagedShellPath);

    console.log(`Signing packaged engine: ${packagedEnginePath}`);
    signFile(signtoolPath, certificate.path, certificatePassword, timestampUrl, packagedEnginePath);

    archiveWindowsDirectory(packagedDirPath, packagedArchivePath);
    console.log(`Rebuilt native Windows package archive: ${packagedArchivePath}`);

    if (!bundleOnly) {
      run(process.execPath, [path.join(rootDir, "scripts", "native-installer.mjs"), "--target=windows"]);
      run(process.execPath, [path.join(rootDir, "scripts", "native-update-repo.mjs"), "--target=windows"]);

      console.log(`Signing native Windows installer: ${installerPath}`);
      signFile(signtoolPath, certificate.path, certificatePassword, timestampUrl, installerPath);
    }
  } finally {
    certificate.cleanup?.();
  }

  console.log(bundleOnly ? "Native Windows bundle signing completed." : "Native Windows signing completed.");
}

// Runs only as `node scripts/native-sign-windows.mjs …`: an import does
// nothing (2026-09-26). With a certificate the run signs the executables in
// release/native/windows in place — on the studio workstation the installed
// app — rebuilds its zip and starts native-installer.mjs and
// native-update-repo.mjs; without one it ends the process. The two paths are
// compared as real paths — through a directory junction or a short 8.3 name,
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
