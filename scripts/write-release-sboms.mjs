// write-release-sboms.mjs — CycloneDX SBOMs for what a packaged bundle carries
// (production readiness 2026-09, Slice 12 — finding F17, decision D2).
//
//   node scripts/write-release-sboms.mjs --target=windows|macos
//
// Three files under `release/sbom/<target>/`, one per thing inside the bundle:
//
//   …-frontend.cdx.json  the npm packages compiled into the web assets
//                        (`cyclonedx-npm --omit dev`, from `tools/sbom/`)
//   …-engine.cdx.json    the crates in `studio-control-engine`
//   …-shell.cdx.json     the crates in `sse-exed-tauri-shell`
//                        (`cargo cyclonedx --describe binaries`, for the
//                        target's triple — so no GTK in a Windows SBOM)
//
// Each file is read back and refused unless it is a CycloneDX 1.5 document
// that names the right component at the right version and lists the one
// dependency that component cannot exist without: an SBOM that is empty, or is
// of something else, fails here instead of being uploaded as evidence.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_VERSION = "1.5";

export const TARGETS = {
  windows: { triple: "x86_64-pc-windows-msvc", fileLabel: "windows" },
  macos: { triple: "aarch64-apple-darwin", fileLabel: "macOS" },
};

export function parseTarget(value) {
  if (Object.hasOwn(TARGETS, value ?? "")) {
    return value;
  }
  throw new Error(`Unsupported target '${value}'. Use --target=macos or --target=windows.`);
}

/** The three SBOMs of a target: where each lands and what it must describe. */
export function sbomPlan(root, target, version) {
  const { fileLabel } = TARGETS[parseTarget(target)];
  const dir = path.join(root, "release", "sbom", target);
  const file = (part) => path.join(dir, `SSE-ExEd-Studio-Control-Native-${fileLabel}-${part}.cdx.json`);
  return [
    { part: "frontend", path: file("frontend"), component: "sse-exed-studio-control", version, mustList: "react" },
    {
      part: "engine",
      path: file("engine"),
      component: "studio-control-engine",
      version,
      mustList: "rusqlite",
      cargoOutput: path.join(root, "native", "rust-engine", "studio-control-engine_bin.cdx.json"),
    },
    {
      part: "shell",
      path: file("shell"),
      component: "sse-exed-tauri-shell",
      version,
      mustList: "tauri",
      cargoOutput: path.join(root, "native", "tauri-shell", "sse-exed-tauri-shell_bin.cdx.json"),
    },
  ];
}

function componentNames(components, names = new Set()) {
  for (const component of components ?? []) {
    names.add(component.name);
    componentNames(component.components, names);
  }
  return names;
}

/** Why `bom` is not the SBOM `expected` asks for, or null when it is. */
export function sbomProblem(bom, expected) {
  if (!bom || bom.bomFormat !== "CycloneDX") {
    return "not a CycloneDX document";
  }
  if (bom.specVersion !== SPEC_VERSION) {
    return `CycloneDX ${bom.specVersion}, expected ${SPEC_VERSION}`;
  }
  const described = bom.metadata?.component;
  if (described?.name !== expected.component || described?.version !== expected.version) {
    return `describes ${described?.name}@${described?.version}, expected ${expected.component}@${expected.version}`;
  }
  const names = componentNames(bom.components);
  if (!names.has(expected.mustList)) {
    return `lists ${names.size} component(s) and '${expected.mustList}' is not among them`;
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? rootDir, stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `${command} could not be started: ${result.error.message}${options.hint ? ` ${options.hint}` : ""}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.${options.hint ? ` ${options.hint}` : ""}`
    );
  }
}

function main() {
  const targetFlag = process.argv.slice(2).find((arg) => arg.startsWith("--target="));
  const target = parseTarget(targetFlag?.slice("--target=".length));
  const version = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
  const plan = sbomPlan(rootDir, target, version);
  const outputDir = path.dirname(plan[0].path);

  const cyclonedxNpm = path.join(
    rootDir,
    "tools",
    "sbom",
    "node_modules",
    "@cyclonedx",
    "cyclonedx-npm",
    "bin",
    "cyclonedx-npm-cli.js"
  );
  if (!existsSync(cyclonedxNpm)) {
    throw new Error("cyclonedx-npm is not installed. Run `npm ci --prefix tools/sbom --ignore-scripts` first.");
  }

  rmSync(outputDir, { force: true, recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const [frontend, ...crates] = plan;
  run(process.execPath, [
    cyclonedxNpm,
    "--omit",
    "dev",
    "--spec-version",
    SPEC_VERSION,
    "--output-format",
    "JSON",
    "--output-file",
    frontend.path,
  ]);

  // cargo-cyclonedx writes beside each crate's manifest and has no output
  // directory, so its files are moved — and never left behind in the tree.
  try {
    run(
      "cargo",
      [
        "cyclonedx",
        "--format",
        "json",
        "--spec-version",
        SPEC_VERSION,
        "--describe",
        "binaries",
        "--target",
        TARGETS[target].triple,
      ],
      {
        cwd: path.join(rootDir, "native"),
        hint: "Is cargo-cyclonedx installed (`cargo install cargo-cyclonedx --locked`)?",
      }
    );
    for (const crate of crates) {
      if (!existsSync(crate.cargoOutput)) {
        throw new Error(`cargo cyclonedx did not write ${path.relative(rootDir, crate.cargoOutput)}.`);
      }
      renameSync(crate.cargoOutput, crate.path);
    }
  } finally {
    for (const crate of crates) rmSync(crate.cargoOutput, { force: true });
  }

  for (const expected of plan) {
    const raw = readFileSync(expected.path);
    const bom = JSON.parse(raw.toString("utf8"));
    const problem = sbomProblem(bom, expected);
    if (problem) {
      throw new Error(`${path.basename(expected.path)}: ${problem}.`);
    }
    const count = componentNames(bom.components).size;
    console.log(
      `${createHash("sha256").update(raw).digest("hex")}  ${path.basename(expected.path)}  (${count} components)`
    );
  }
  console.log(
    `Wrote ${plan.length} CycloneDX ${SPEC_VERSION} SBOMs for ${target}: ${path.relative(rootDir, outputDir)}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
