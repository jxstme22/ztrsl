"""One-time Helsinki opus-mt (en->zh) -> CTranslate2 int8 export.

Helsinki's MarianMT checkpoints ship only as PyTorch ``pytorch_model.bin``
(plus SentencePiece models), so before the local provider can translate with
CTranslate2 we must convert the weights once (Marian is a supported
CTranslate2 architecture). This tool performs that conversion and writes a
verified manifest into ``models/artifacts/opus-mt-en-zh-ct2-int8/``.

The resulting provider is English->Chinese only and runs fully offline.
Unlike NLLB (CC-BY-NC-4.0) the model is Apache-2.0, so it is the
commercially usable local translation option.

Requirements (one-time, heavy):

- ``pip install transformers torch ctranslate2 sentencepiece huggingface_hub``
  into a build venv (NOT the runtime inference venv; see AGENTS.md). The
  runtime inference venv already ships ctranslate2; it additionally needs
  ``sentencepiece`` for the Marian tokenization (models extra).
- ~1.2 GB free disk for torch plus the ~310 MB model.

Usage:

    .venv-build/Scripts/python scripts/export_opus_mt_ct2.py --accept-license
    (Windows)
    .venv-build/bin/python scripts/export_opus_mt_ct2.py --accept-license
    (macOS/Linux)

Outputs into ``models/artifacts/opus-mt-en-zh-ct2-int8/``:

- ``model.bin``              (CTranslate2 Marian int8 model)
- ``config.json``            (CTranslate2 config)
- ``shared_vocabulary.json`` (shared source/target vocabulary)
- ``source.spm``             (source SentencePiece model)
- ``target.spm``             (target SentencePiece model)
- ``manifest.json``          (checksummed artifact manifest)

License: Apache-2.0 (Helsinki-NLP/opus-mt-en-zh).
Verify at https://huggingface.co/Helsinki-NLP/opus-mt-en-zh
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

REPO_ID = "Helsinki-NLP/opus-mt-en-zh"
MODEL_ID = "opus-mt-en-zh-ct2-int8"
SOURCE_URL = f"https://huggingface.co/{REPO_ID}"
REVISION = "main"

REQUIRED_FILES = (
    "pytorch_model.bin",
    "config.json",
    "generation_config.json",
    "source.spm",
    "target.spm",
    "vocab.json",
    "tokenizer_config.json",
)

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = ROOT / "models" / "artifacts"


class ExportError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(target: Path) -> None:
    artifacts = []
    for role, filename in (
        ("model", "model.bin"),
        ("config", "config.json"),
        ("shared_vocab", "shared_vocabulary.json"),
        ("source_spm", "source.spm"),
        ("target_spm", "target.spm"),
    ):
        artifact = target / filename
        artifacts.append(
            {
                "role": role,
                "path": filename,
                "size_bytes": artifact.stat().st_size,
                "sha256": sha256(artifact),
            }
        )
    manifest = {
        "schema_version": 1,
        "id": MODEL_ID,
        "kind": "translation",
        "source": SOURCE_URL,
        "revision": REVISION,
        "license": {"spdx": "Apache-2.0"},
        "artifacts": artifacts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def download_sources(staging: Path) -> Path:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as error:
        raise ExportError("download requires 'huggingface_hub' in the build venv") from error
    model_dir = staging / "source"
    model_dir.mkdir()
    for filename in REQUIRED_FILES:
        hf_hub_download(repo_id=REPO_ID, filename=filename, local_dir=str(model_dir))
    return model_dir


def convert(model_dir: Path, staging: Path) -> Path:
    try:
        import ctranslate2.converters
        import torch
        import transformers  # noqa: F401
    except ImportError as error:
        raise ExportError(
            "opus-mt conversion requires 'transformers', 'torch', 'ctranslate2' "
            "and 'sentencepiece' in a build venv. Do not add them to the runtime "
            "inference venv."
        ) from error
    if not torch.cuda.is_available():
        print("CUDA not detected; conversion runs on CPU (int8 quantization).")
    output = staging / "ct2"
    converter = ctranslate2.converters.TransformersConverter(str(model_dir))
    converter.convert(output_dir=str(output), quantization="int8")
    shutil.copy2(model_dir / "source.spm", output / "source.spm")
    shutil.copy2(model_dir / "target.spm", output / "target.spm")
    for required in (
        "model.bin",
        "config.json",
        "shared_vocabulary.json",
        "source.spm",
        "target.spm",
    ):
        if not (output / required).is_file():
            raise ExportError(f"conversion did not produce {required}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--accept-license",
        action="store_true",
        help="confirm the Apache-2.0 license has been reviewed",
    )
    parser.add_argument(
        "--repo-dir",
        type=Path,
        help="already-downloaded Helsinki repo directory instead of downloading",
    )
    args = parser.parse_args()
    if not args.accept_license:
        raise SystemExit("Pass --accept-license after reviewing the Apache-2.0 license.")
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        source = args.repo_dir or download_sources(staging)
        if not (source / "pytorch_model.bin").is_file():
            raise ExportError(f"pytorch_model.bin not found in {source}")
        output = convert(source, staging)
        target_staging = staging / MODEL_ID
        target_staging.mkdir()
        for filename in (
            "model.bin",
            "config.json",
            "shared_vocabulary.json",
            "source.spm",
            "target.spm",
        ):
            shutil.copy2(output / filename, target_staging / filename)
        write_manifest(target_staging)
        destination = ARTIFACT_ROOT / MODEL_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {MODEL_ID}")


if __name__ == "__main__":
    main()
