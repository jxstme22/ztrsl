// Build the Python sidecar into a standalone onedir using PyInstaller and
// stage it (plus the translation-runner) where Tauri expects them.
//
// Usage: node scripts/build-sidecar.mjs
//
// Prerequisites:
//   - uv sync --extra dev --extra models  (or equivalent pip install in .venv)
//   - PyInstaller installed in the venv:  uv pip install pyinstaller
//
// Output: apps/desktop/src-tauri/sidecars/
//   - local-squad-sidecar/local-squad-sidecar.exe  (frozen onedir)
//   - translation-runner.exe                        (MADLAD candle runner)

import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VENV_PYTHON = resolve(ROOT, ".venv", "Scripts", "python.exe");
const VENV_PYTHON_ALT = resolve(ROOT, ".venv", "bin", "python3");
const PYTHON = existsSync(VENV_PYTHON)
  ? VENV_PYTHON
  : existsSync(VENV_PYTHON_ALT)
    ? VENV_PYTHON_ALT
    : "python";
// macOS ships the Apple Silicon (MLX) ASR runtime in the sidecar so captions
// run on the Metal GPU/ANE. Windows/CUDA keeps faster-whisper only.
const IS_MACOS = process.platform === "darwin";

const BUILD_ROOT = resolve(ROOT, "target", "sidecar-build");
const DIST_DIR = resolve(BUILD_ROOT, "dist");
const WORK_DIR = resolve(BUILD_ROOT, "work");
const ENTRY_POINT = resolve(
  ROOT,
  "services",
  "inference",
  "src",
  "local_squad_inference",
  "sidecar.py",
);
const SOURCE_ROOT = resolve(ROOT, "services", "inference", "src");
const SIDECAR_DIR = resolve(ROOT, "apps", "desktop", "src-tauri", "sidecars");
const RUNNER_REL = resolve(ROOT, "target", "release", "translation-runner.exe");
const RUNNER_ALT = resolve(ROOT, "target", "debug", "translation-runner.exe");
const RUNNER = existsSync(RUNNER_REL) ? RUNNER_REL : RUNNER_ALT;

if (!existsSync(ENTRY_POINT)) {
  console.error("sidecar.py not found at", ENTRY_POINT);
  process.exit(1);
}

mkdirSync(DIST_DIR, { recursive: true });
mkdirSync(SIDECAR_DIR, { recursive: true });

const args = [
  PYTHON,
  "-m",
  "PyInstaller",
  "--onedir",
  "--noconfirm",
  "--clean",
  "--name",
  "local-squad-sidecar",
  "--distpath",
  DIST_DIR,
  "--workpath",
  WORK_DIR,
  // Make `local_squad_inference` (under services/inference/src) importable.
  "--paths",
  SOURCE_ROOT,
  "--collect-submodules",
  "local_squad_inference",
  "--hidden-import",
  "ctranslate2",
  "--hidden-import",
  "faster_whisper",
  "--hidden-import",
  "onnxruntime",
  "--hidden-import",
  "sherpa_onnx",
  "--hidden-import",
  "sentencepiece",
  "--hidden-import",
  "av",
  "--hidden-import",
  "websockets",
  "--hidden-import",
  "numpy",
  ...(IS_MACOS
    ? [
        "--hidden-import",
        "mlx_whisper",
        "--collect-all",
        "mlx_whisper",
        "--collect-all",
        "mlx",
      ]
    : []),
  "--collect-all",
  "ctranslate2",
  "--collect-all",
  "onnxruntime",
  "--collect-all",
  "sherpa_onnx",
  "--collect-data",
  "faster_whisper", // includes the bundled silero_vad_v6.onnx
  "--collect-binaries",
  "av", // PyAV FFmpeg DLLs
  "--collect-binaries",
  "onnxruntime",
  ENTRY_POINT,
];

console.log("Building sidecar with PyInstaller...");
console.log("  python:", PYTHON);
console.log("  entry :", ENTRY_POINT);
console.log("  dist  :", DIST_DIR);

try {
  execSync(args.join(" "), { cwd: ROOT, stdio: "inherit" });
} catch {
  console.error("Sidecar build failed.");
  process.exit(1);
}

// Stage the frozen onedir into the Tauri resources folder.
const builtDir = resolve(DIST_DIR, "local-squad-sidecar");
const stagedDir = resolve(SIDECAR_DIR, "local-squad-sidecar");
console.log("Staging sidecar ->", stagedDir);
rmSync(stagedDir, { recursive: true, force: true });
cpSync(builtDir, stagedDir, { recursive: true });

// Translation-runner (MADLAD candle runner) next to it.
if (existsSync(RUNNER)) {
  console.log("Staging translation-runner ->", SIDECAR_DIR);
  copyFileSync(RUNNER, resolve(SIDECAR_DIR, "translation-runner.exe"));
} else {
  console.warn(
    "translation-runner.exe not found; run `cargo build --release -p translation-runner` first",
  );
}

console.log("Sidecar staging complete.");
