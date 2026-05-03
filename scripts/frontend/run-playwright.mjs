import { spawn } from "node:child_process";

const env = { ...process.env };
delete env.NO_COLOR;

const command = process.platform === "win32" ? "playwright.cmd" : "playwright";
const child = spawn(command, process.argv.slice(2), {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

child.on("close", (exitCode) => {
  process.exitCode = exitCode ?? 1;
});
