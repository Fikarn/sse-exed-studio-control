// NDI's library for the pictures helper (D17, D33): the NDI SDK's own
// `Processing.NDI.Lib.x64.dll`, which the owner installed with the SDK after
// accepting NDI's agreement. It is never put in git. A small tracked file,
// `native/pictures-link/ndi-library.json`, pins its version and its SHA-256;
// `npm run app -- --vmix-pictures` hands the helper the SDK's file only when
// its hash is the pinned one, and the studio build's step will copy that same
// file into the build.
//
// Where the SDK is: `NDI_SDK_DIR`, which the SDK's installer sets for the
// machine, or its own default folder when a terminal started before the
// install does not hold it yet.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The pin, in the repository. */
export const NDI_PIN_FILE = path.join("native", "pictures-link", "ndi-library.json");

/** Where the SDK's installer puts the SDK when `NDI_SDK_DIR` is not in the environment. */
const DEFAULT_SDK_FOLDER = ["NDI", "NDI 6 SDK"];

/** The pinned version, file name and SHA-256, held to their shapes. */
export function readNdiPin(repositoryRoot) {
  const pin = JSON.parse(readFileSync(path.join(repositoryRoot, NDI_PIN_FILE), "utf8"));
  if (pin.file !== "Processing.NDI.Lib.x64.dll") {
    throw new Error(`${NDI_PIN_FILE} names ${JSON.stringify(pin.file)}, not NDI's library.`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(pin.sha256))) {
    throw new Error(`${NDI_PIN_FILE} holds no SHA-256 of 64 lowercase hexadecimal characters.`);
  }
  if (!/^\d+(\.\d+){1,3}$/.test(String(pin.version))) {
    throw new Error(`${NDI_PIN_FILE} holds no version.`);
  }
  return { file: pin.file, version: pin.version, sha256: pin.sha256 };
}

/** The SDK's library for 64-bit Windows, by its full path, as `env` gives the SDK's folder. */
export function sdkLibraryPath(env, pin) {
  const sdk = env.NDI_SDK_DIR || path.win32.join(env.ProgramFiles || "C:\\Program Files", ...DEFAULT_SDK_FOLDER);
  return path.win32.join(sdk, "Bin", "x64", pin.file);
}

/**
 * Why the file at `filePath` is not the pinned library, or null when it is:
 * a file of the pinned name whose SHA-256 is the pinned one.
 */
export function ndiLibraryRefusal(filePath, pin) {
  if (path.win32.basename(filePath).toLowerCase() !== pin.file.toLowerCase()) {
    return `${filePath} is not NDI's library (${pin.file}).`;
  }
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return `NDI's library is not at ${filePath}: install the NDI SDK ${pin.version} (the standard SDK for Windows), or set NDI_SDK_DIR to its folder.`;
  }
  if (!stat.isFile()) {
    return `${filePath} is not a file.`;
  }
  const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (sha256 !== pin.sha256) {
    return `${filePath} is not the pinned NDI library ${pin.version}: its SHA-256 is ${sha256}, the pin's ${pin.sha256} (${NDI_PIN_FILE}). A newer SDK is taken by changing the pin, on the owner's word.`;
  }
  return null;
}
