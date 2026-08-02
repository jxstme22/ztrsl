#!/usr/bin/env node
// Ensures `target/release/translation-runner` is built before the Tauri app
// runs. Skips the build when the binary already exists and is newer than the
// crate sources, so repeated `tauri dev` invocations are instant.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, "..");
const crateDir = join(workspaceRoot, "crates", "translation-runner");
const binaryPath =
  process.platform === "win32"
    ? join(workspaceRoot, "target", "release", "translation-runner.exe")
    : join(workspaceRoot, "target", "release", "translation-runner");

function collectSourceTimestamps(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "target" || entry.name === ".git") continue;
      collectSourceTimestamps(full, acc);
    } else if (entry.isFile()) {
      acc.push(statSync(full).mtimeMs);
    }
  }
  return acc;
}

function binaryIsFresh() {
  if (!existsSync(binaryPath)) return false;
  const binaryMtime = statSync(binaryPath).mtimeMs;
  const sourceTimes = collectSourceTimestamps(crateDir, []);
  const newestSource = sourceTimes.reduce((a, b) => (b > a ? b : a), 0);
  return binaryMtime >= newestSource;
}

if (binaryIsFresh()) {
  process.exit(0);
}

const result = spawnSync(
  "cargo",
  ["build", "--release", "-p", "translation-runner"],
  {
    cwd: workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
