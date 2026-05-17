import { statfsSync } from "node:fs";

export const RELEASE_BUILD_MIN_FREE_BYTES = 8 * 1024 ** 3;

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${Math.round(bytes / 1024 ** 2)} MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${bytes} B`;
}

export function getAvailableDiskSpaceBytes(targetPath) {
  const stats = statfsSync(targetPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function checkAvailableDiskSpace({ availableBytes, label, requiredBytes }) {
  if (availableBytes >= requiredBytes) {
    return {
      ok: true,
      message: `${label} has ${formatBytes(availableBytes)} available.`,
    };
  }

  return {
    ok: false,
    message: `${label} requires at least ${formatBytes(requiredBytes)} free, but the current filesystem has ${formatBytes(
      availableBytes
    )} free. Run \`npm run clean:local\` to remove ignored build/evidence output, then free additional disk space if needed.`,
  };
}

export function assertAvailableDiskSpace({
  label,
  requiredBytes = RELEASE_BUILD_MIN_FREE_BYTES,
  targetPath = process.cwd(),
}) {
  const availableBytes = getAvailableDiskSpaceBytes(targetPath);
  const result = checkAvailableDiskSpace({ availableBytes, label, requiredBytes });
  if (!result.ok) {
    throw new Error(result.message);
  }
  console.log(`Disk preflight: ${result.message}`);
}
