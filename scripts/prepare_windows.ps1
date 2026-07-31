param(
    [switch]$AcceptModelLicenses,
    [switch]$SkipModels
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Require-Command {
    param([string]$Name, [string]$InstallHint)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. $InstallHint"
    }
}

Require-Command "uv" "Install uv from https://docs.astral.sh/uv/."
Require-Command "cargo" "Install stable Rust with the MSVC toolchain."
Require-Command "pnpm" "Install Node.js 22+, enable Corepack, then activate the pinned pnpm."
Require-Command "ffmpeg" "Install FFmpeg and ensure ffmpeg.exe and ffprobe.exe are on PATH."
Require-Command "ffprobe" "Install FFmpeg and ensure ffmpeg.exe and ffprobe.exe are on PATH."
Require-Command "nvidia-smi" "Install the current NVIDIA Studio or Game Ready driver."

Write-Host "Checking NVIDIA adapter..."
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

Write-Host "Installing pinned development and inference runtimes..."
uv sync --frozen --extra dev --extra models
pnpm install --frozen-lockfile

Write-Host "Building the persistent local translation worker..."
cargo build --release -p translation-runner

if (-not $SkipModels) {
    if (-not $AcceptModelLicenses) {
        throw "Review models/README.md, then rerun with -AcceptModelLicenses."
    }
    $DriveName = ([System.IO.Path]::GetPathRoot($Root)).Substring(0, 1)
    $FreeBytes = (Get-PSDrive -Name $DriveName).Free
    if ($FreeBytes -lt 10GB) {
        throw "At least 10 GB free disk space is required for verified model staging."
    }
    Write-Host "Installing and checksum-verifying Whisper large-v3..."
    uv run --extra models python scripts/install_models.py whisper --accept-license
    Write-Host "Installing and checksum-verifying MADLAD..."
    uv run --extra models python scripts/install_models.py madlad --accept-license
}

Write-Host "Checking CTranslate2 CUDA visibility..."
uv run --extra models python -c "import ctranslate2; count=ctranslate2.get_cuda_device_count(); print(f'CUDA devices: {count}'); raise SystemExit(0 if count > 0 else 'CTranslate2 cannot see CUDA. Install CUDA 12 and cuDNN 9 runtime libraries, then retry.')"

Write-Host "Running repository checks..."
& "$PSScriptRoot/check.ps1"

Write-Host ""
Write-Host "Windows preparation passed."
Write-Host "Launch with: pnpm --filter @local-squad-translator/desktop tauri dev"
