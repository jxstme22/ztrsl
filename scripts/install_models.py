from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = ROOT / "models" / "artifacts"
ASR_ID = "omni-ctc-300m-int8"
ASR_ARCHIVE = "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12.tar.bz2"
ASR_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + ASR_ARCHIVE
ASR_ARCHIVE_SHA256 = "cdcd0559c7c73efed54209a926e321afc914d046c5fdbf3665f00dc78180e5ed"
MADLAD_ID = "madlad400-3b-mt"
MADLAD_REVISION = "fa184c6"
MADLAD_FILES = (
    "config.json",
    "model-q4k.gguf",
    "tokenizer.json",
)
WHISPER_ID = "whisper-large-v3"
WHISPER_REPO = "Systran/faster-whisper-large-v3"
WHISPER_REVISION = "edaa852ec7e145841d8ffdb056a99866b5f0a478"
WHISPER_FILES = (
    "config.json",
    "model.bin",
    "preprocessor_config.json",
    "tokenizer.json",
    "vocabulary.json",
)
WHISPER_TURBO_ID = "whisper-large-v3-turbo"
WHISPER_TURBO_REPO = "dropbox-dash/faster-whisper-large-v3-turbo"
WHISPER_TURBO_REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"

NLLB_ID = "nllb-200-distilled-600M-ct2-int8"
NLLB_REPO = "mijuanlo/nllb-200-distilled-600M-ct2-int8"
NLLB_REVISION = "16bc5ff0482f9f1c0d35bdef950721ce58640789"
NLLB_MANIFEST = "nllb-200-distilled-600M-ct2-int8.json"
NLLB_FILES = (
    "config.json",
    "model.bin",
    "shared_vocabulary.json",
    "tokenizer.json",
)

MLX_ID = "mlx-whisper-large-v3-turbo-q4"
MLX_REPO = "mlx-community/whisper-large-v3-turbo-q4"
MLX_REVISION = "660c343bbf4e52ac257f0b7d952e5388e6f93bef"
MLX_MANIFEST = "mlx-whisper-large-v3-turbo-q4.json"
MLX_FILES = (
    "config.json",
    "weights.npz",
)

WHISPER_SPECS: dict[str, dict[str, str]] = {
    WHISPER_ID: {
        "repo": WHISPER_REPO,
        "revision": WHISPER_REVISION,
        "manifest": "whisper-large-v3.json",
    },
    WHISPER_TURBO_ID: {
        "repo": WHISPER_TURBO_REPO,
        "revision": WHISPER_TURBO_REVISION,
        "manifest": "whisper-large-v3-turbo.json",
    },
}


class InstallError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(
    target: Path,
    *,
    model_id: str,
    kind: str,
    source: str,
    revision: str,
    license_spdx: str,
    roles: dict[str, str],
) -> None:
    artifacts = []
    for role, relative in roles.items():
        artifact = target / relative
        artifacts.append(
            {
                "role": role,
                "path": relative,
                "size_bytes": artifact.stat().st_size,
                "sha256": sha256(artifact),
            }
        )
    manifest = {
        "schema_version": 1,
        "id": model_id,
        "kind": kind,
        "source": source,
        "revision": revision,
        "license": {"spdx": license_spdx},
        "artifacts": artifacts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def verify_committed_manifest(target: Path, manifest_name: str) -> None:
    manifest_path = ROOT / "models" / "manifests" / manifest_name
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        artifacts = manifest["artifacts"]
    except (OSError, KeyError, json.JSONDecodeError) as error:
        raise InstallError("committed model manifest is missing or invalid") from error
    for artifact in artifacts:
        candidate = target / artifact["path"]
        if not candidate.is_file():
            raise InstallError(f"downloaded model is missing {artifact['path']}")
        if candidate.stat().st_size != artifact["size_bytes"]:
            raise InstallError(f"downloaded model size failed for {artifact['path']}")
        if sha256(candidate) != artifact["sha256"]:
            raise InstallError(f"downloaded model checksum failed for {artifact['path']}")


def install_asr(archive_override: Path | None) -> None:
    if "PENDING" in ASR_ARCHIVE_SHA256:
        raise InstallError("ASR archive checksum has not been pinned")
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        archive = archive_override or staging / ASR_ARCHIVE
        if archive_override is None:
            with (
                urllib.request.urlopen(ASR_URL, timeout=60) as response,
                archive.open("wb") as output,
            ):
                shutil.copyfileobj(response, output, length=1024 * 1024)
        if sha256(archive) != ASR_ARCHIVE_SHA256:
            raise InstallError("ASR archive checksum failed")
        extracted = staging / "extracted"
        extracted.mkdir()
        with tarfile.open(archive, "r:bz2") as bundle:
            bundle.extractall(extracted, filter="data")
        roots = [path for path in extracted.iterdir() if path.is_dir()]
        if len(roots) != 1:
            raise InstallError("ASR archive layout is invalid")
        source = roots[0]
        target_staging = staging / ASR_ID
        target_staging.mkdir()
        for filename in ("model.int8.onnx", "tokens.txt", "LICENSE"):
            candidate = source / filename
            if not candidate.is_file():
                raise InstallError(f"ASR archive is missing {filename}")
            shutil.copy2(candidate, target_staging / filename)
        write_manifest(
            target_staging,
            model_id=ASR_ID,
            kind="asr",
            source=ASR_URL,
            revision="2025-11-12",
            license_spdx="Apache-2.0",
            roles={"model": "model.int8.onnx", "tokens": "tokens.txt"},
        )
        destination = ARTIFACT_ROOT / ASR_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {ASR_ID}")


def install_madlad() -> None:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise InstallError("install the 'models' Python extra first") from error
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        target_staging = staging / MADLAD_ID
        snapshot_download(
            repo_id="google/madlad400-3b-mt",
            revision=MADLAD_REVISION,
            allow_patterns=list(MADLAD_FILES),
            local_dir=target_staging,
            cache_dir=staging / ".hf-cache",
        )
        for filename in MADLAD_FILES:
            if not (target_staging / filename).is_file():
                raise InstallError(f"MADLAD snapshot is missing {filename}")
        write_manifest(
            target_staging,
            model_id=MADLAD_ID,
            kind="translation",
            source="https://huggingface.co/google/madlad400-3b-mt",
            revision=MADLAD_REVISION,
            license_spdx="Apache-2.0",
            roles={
                "config": "config.json",
                "model": "model-q4k.gguf",
                "tokenizer": "tokenizer.json",
            },
        )
        destination = ARTIFACT_ROOT / MADLAD_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {MADLAD_ID}")


def install_whisper(model_id: str = WHISPER_ID) -> None:
    spec = WHISPER_SPECS.get(model_id)
    if spec is None:
        raise InstallError(f"unknown Whisper model id: {model_id}")
    repo = spec["repo"]
    revision = spec["revision"]
    manifest_name = spec["manifest"]
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise InstallError("install the 'models' Python extra first") from error
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        target_staging = staging / model_id
        snapshot_download(
            repo_id=repo,
            revision=revision,
            allow_patterns=list(WHISPER_FILES),
            local_dir=target_staging,
            cache_dir=staging / ".hf-cache",
        )
        for filename in WHISPER_FILES:
            if not (target_staging / filename).is_file():
                raise InstallError(f"Whisper snapshot is missing {filename}")
        verify_committed_manifest(target_staging, manifest_name)
        write_manifest(
            target_staging,
            model_id=model_id,
            kind="asr",
            source=f"https://huggingface.co/{repo}",
            revision=revision,
            license_spdx="MIT",
            roles={
                "model": "model.bin",
                "vocabulary": "vocabulary.json",
                "config": "config.json",
                "tokenizer": "tokenizer.json",
                "preprocessor": "preprocessor_config.json",
            },
        )
        destination = ARTIFACT_ROOT / model_id
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {model_id}")


def install_nllb() -> None:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise InstallError("install the 'models' Python extra first") from error
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        target_staging = staging / NLLB_ID
        snapshot_download(
            repo_id=NLLB_REPO,
            revision=NLLB_REVISION,
            allow_patterns=list(NLLB_FILES),
            local_dir=target_staging,
            cache_dir=staging / ".hf-cache",
        )
        for filename in NLLB_FILES:
            if not (target_staging / filename).is_file():
                raise InstallError(f"NLLB snapshot is missing {filename}")
        verify_committed_manifest(target_staging, NLLB_MANIFEST)
        write_manifest(
            target_staging,
            model_id=NLLB_ID,
            kind="translation",
            source=f"https://huggingface.co/{NLLB_REPO}",
            revision=NLLB_REVISION,
            license_spdx="CC-BY-NC-4.0",
            roles={
                "model": "model.bin",
                "tokenizer": "tokenizer.json",
                "vocabulary": "shared_vocabulary.json",
                "config": "config.json",
            },
        )
        destination = ARTIFACT_ROOT / NLLB_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {NLLB_ID}")


def install_mlx() -> None:
    """Install the Apple Silicon (Metal) Whisper model: MLX-quantized q4 weights.

    Runs on macOS arm64 only (mlx-whisper refuses to import off-Metal). The
    artifact is `config.json` + `weights.npz` in the MLX weight format.
    """
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise InstallError("install the 'models' Python extra first") from error
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        target_staging = staging / MLX_ID
        snapshot_download(
            repo_id=MLX_REPO,
            revision=MLX_REVISION,
            allow_patterns=list(MLX_FILES),
            local_dir=target_staging,
            cache_dir=staging / ".hf-cache",
        )
        for filename in MLX_FILES:
            if not (target_staging / filename).is_file():
                raise InstallError(f"MLX snapshot is missing {filename}")
        verify_committed_manifest(target_staging, MLX_MANIFEST)
        write_manifest(
            target_staging,
            model_id=MLX_ID,
            kind="asr",
            source=f"https://huggingface.co/{MLX_REPO}",
            revision=MLX_REVISION,
            license_spdx="MIT",
            roles={
                "model": "weights.npz",
                "config": "config.json",
            },
        )
        destination = ARTIFACT_ROOT / MLX_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {MLX_ID}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicit verified local model installer")
    parser.add_argument(
        "model",
        choices=("asr", "whisper", "whisper-turbo", "mlx", "madlad", "nllb", "all"),
    )
    parser.add_argument("--archive", type=Path, help="verified ASR archive already on disk")
    parser.add_argument(
        "--accept-license",
        action="store_true",
        help="confirm the model licenses have been reviewed",
    )
    arguments = parser.parse_args()
    if not arguments.accept_license:
        raise SystemExit("Pass --accept-license after reviewing the model licenses.")
    if arguments.model in {"asr", "all"}:
        install_asr(arguments.archive)
    if arguments.model in {"whisper", "all"}:
        install_whisper(WHISPER_ID)
    if arguments.model in {"whisper-turbo", "all"}:
        install_whisper(WHISPER_TURBO_ID)
    if arguments.model in {"mlx", "all"}:
        install_mlx()
    if arguments.model in {"madlad", "all"}:
        install_madlad()
    if arguments.model in {"nllb", "all"}:
        install_nllb()


if __name__ == "__main__":
    main()
