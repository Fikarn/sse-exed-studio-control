import fs from "fs";
import path from "path";

function getRootPath(...segments) {
  return path.join(process.cwd(), ...segments);
}

export function readPackageJson() {
  const packageJsonPath = getRootPath("package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

export function resolveRepositoryHttpUrl(packageJson = readPackageJson()) {
  const homepage = packageJson.homepage;
  if (typeof homepage === "string" && homepage.trim()) {
    return homepage.replace(/#.*$/, "").trim();
  }

  const repositoryUrl =
    typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url ?? null;
  if (typeof repositoryUrl !== "string" || !repositoryUrl.trim()) {
    return null;
  }

  return repositoryUrl
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
}

export function readChangelog() {
  return fs.readFileSync(getRootPath("CHANGELOG.md"), "utf8");
}

export function isValidReleaseTag(tag) {
  return /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag);
}

export function resolveReleaseTag(args = process.argv.slice(2)) {
  const packageJson = readPackageJson();
  const defaultTag = `v${packageJson.version}`;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--tag") {
      return args[index + 1] ?? defaultTag;
    }
    if (!current.startsWith("--")) {
      return current;
    }
  }

  const implicitTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || defaultTag;
  return isValidReleaseTag(implicitTag) ? implicitTag : defaultTag;
}

export function resolveOutputPath(args = process.argv.slice(2)) {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--out") {
      return args[index + 1] ?? null;
    }
  }
  return null;
}

export function extractReleaseSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const headings = [];

  lines.forEach((line, index) => {
    const match = line.match(/^## \[(.+?)\](?:\s+—\s+(.+))?$/);
    if (match) {
      headings.push({
        version: match[1],
        date: match[2] ?? null,
        index,
      });
    }
  });

  const latestReleased = headings.find((heading) => heading.version !== "Unreleased") ?? null;
  const target = headings.find((heading) => heading.version === version) ?? null;

  if (!target) {
    throw new Error(`CHANGELOG.md is missing a section for ${version}.`);
  }

  const nextHeadingIndex = headings.find((heading) => heading.index > target.index)?.index ?? lines.length;
  const body = lines
    .slice(target.index + 1, nextHeadingIndex)
    .join("\n")
    .trim();

  if (!body) {
    throw new Error(`CHANGELOG.md section for ${version} is empty.`);
  }

  return {
    body,
    date: target.date,
    latestReleasedVersion: latestReleased?.version ?? null,
  };
}

/**
 * Format an SHA-256 + filename table for inclusion in the release notes
 * body. The `entries` array is the same shape as `readChecksumEntries`
 * returns (see scripts/release/write-release-manifest.mjs).
 *
 * plan PR 3 / workstream C4: published GitHub Release pages must contain
 * the authoritative artifact hashes, not just the sidecar SHA256 files.
 */
export function formatArtifactHashTable(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const grouped = new Map();
  for (const entry of entries) {
    const list = grouped.get(entry.target) ?? [];
    list.push(entry);
    grouped.set(entry.target, list);
  }
  const sections = [];
  for (const target of ["macos", "windows"]) {
    const list = grouped.get(target);
    if (!list || list.length === 0) continue;
    sections.push(`### ${target}`);
    sections.push("");
    sections.push("```");
    for (const entry of list) sections.push(`${entry.sha256}  ${entry.name}`);
    sections.push("```");
    sections.push("");
  }
  return sections.length === 0 ? null : sections.join("\n");
}

export function formatReleaseNotes({ body, repoUrl, artifactHashes = null }) {
  const trimmedBody = body.trim();
  const releaseGuideUrl = repoUrl ? `${repoUrl}/blob/main/docs/RELEASE.md` : null;
  const operationsGuideUrl = repoUrl ? `${repoUrl}/blob/main/docs/OPERATIONS.md` : null;
  const lines = [
    "## Install / Update",
    "",
    "- Windows 11 `x64`: download `SSE-ExEd-Studio-Control-Native-windows-Installer.exe` and run the offline installer.",
    "- macOS Apple Silicon: download `SSE-ExEd-Studio-Control-Native-macOS-Installer.zip`, open it, and launch `SSE-ExEd-Studio-Control-Native-macOS-Installer.app`.",
    "- Existing workstations: prefer the maintenance-tool update repository or a newer offline installer during a safe update window.",
    "- Support-only packaged bundle zips are published for smoke and debugging; first-time installs should use the installer artifacts instead.",
    "- Verify downloaded artifacts against the published per-platform `SHA256` manifest before operator rollout.",
    "- User data should survive install, update, reinstall, and rollback unless the workstation app-data directory is deleted on purpose.",
    "",
    "## Update Artifacts",
    "",
    "- `SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip`",
    "- `SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`",
    "- `SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt`",
    "- `SSE-ExEd-Studio-Control-Native-windows-SHA256.txt`",
    "",
  ];

  const hashTable = formatArtifactHashTable(artifactHashes);
  if (hashTable) {
    lines.push("## Artifact verification", "");
    lines.push(
      "Authoritative SHA-256 hashes for the artifacts attached to this release. The sidecar `*-SHA256.txt` assets are produced by the same step.",
      ""
    );
    lines.push(hashTable);
  }

  lines.push("## Operator Guidance", "");

  if (releaseGuideUrl) {
    lines.push(`- [Release flow and installer details](${releaseGuideUrl})`);
  }
  if (operationsGuideUrl) {
    lines.push(`- [Runtime, recovery, and rollback guidance](${operationsGuideUrl})`);
  }
  if (!releaseGuideUrl && !operationsGuideUrl) {
    lines.push(
      "- See the repo release and operations documentation for installer, update, recovery, and rollback details."
    );
  }

  lines.push("", "## What's Changed", "", trimmedBody, "");
  return lines.join("\n");
}

export function writeOutputFile(outputPath, content) {
  const absolutePath = path.isAbsolute(outputPath) ? outputPath : getRootPath(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}
