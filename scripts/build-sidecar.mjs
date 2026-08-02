// Build the Python sidecar into a standalone onedir using PyInstaller.
//
// Usage: node scripts/build-sidecar.mjs
//
// Prerequisites:
//   - uv sync --extra dev --extra models  (or equivalent pip install in .venv)
//   - PyInstaller installed in the venv
//
// Output: target/sidecar/local-squad-sidecar.exe + _internal/

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VENV_PYTHON = resolve(ROOT, ".venv", "Scripts", "python.exe");
const VENV_PYTHON_ALT = resolve(ROOT, ".venv", "bin", "python3");
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : existsSync(VENV_PYTHON_ALT) ? VENV_PYTHON_ALT : "python";

const OUT_DIR = resolve(ROOT, "target", "sidecar");
const ENTRY_POINT = resolve(ROOT, "services", "inference", "src", "local_squad_inference", "sidecar.py");

if (!existsSync(ENTRY_POINT)) {
  console.error("sidecar.py not found at", ENTRY_POINT);
  process.exit(1);
}

const args = [
  PYTHON,
  "-m",
  "PyInstaller",
  "--onedir",
  "--name", "local-squad-sidecar",
  "--distpath", OUT_DIR,
  "--workpath", resolve(ROOT, "target", ".pyinstaller-work"),
  "--add-data", `${resolve(ROOT, "services", "inference", "src", "local_squad_inference")};local_squad_inference`,
  "--hidden-import", "ctranslate2",
  "--hidden-import", "faster_whisper",
  "--hidden-import", "onnxruntime",
  "--hidden-import", "sherpa_onnx",
  "--hidden-import", "av",
  "--hidden-import", "websockets",
  "--hidden-import", "numpy",
  "--collect-data", "faster_whisper",
  "--collect-all", "ctranslate2",
  "--collect-all", "onnxruntime",
  "--collect-all", "sherpa_onnx",
  "--collect-submodules", "local_squad_inference",
  ENTRY_POINT,
];

console.log("Building sidecar with PyInstaller...");
console.log("  python:", PYTHON);
console.log("  output:", resolve(OUT_DIR, "local-squad-sidecar"));

try {
  execSync(args.join(" "), { cwd: ROOT, stdio: "inherit" });
  console.log("Sidecar build complete.");
} catch {
  console.error("Sidecar build failed.");
  process.exit(1);
}