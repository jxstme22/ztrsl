"""One-time NCSpeech FastConformer (Tagalog) -> CTC ONNX export.

NCSpeech ships only as a PyTorch ``.nemo`` archive, so before the local
provider can decode it with sherpa-onnx we must export the CTC branch to ONNX
once. This tool performs that export and writes a verified manifest.

Requirements (one-time, heavy):

- ``pip install "nemo_toolkit[asr]>=2.0.0" torch`` into a build venv
  (NOT the runtime inference venv; see AGENTS.md dependency pinning).
- ~2-3 GB free disk for torch/nemo plus the ~460 MB model archive.

Usage:

    .venv-build\\Scripts\\python scripts\\export_ncspeech_onnx.py

Outputs into ``models/artifacts/ncspeech-tl-fastconformer-hybrid-large/``:

- ``model.int8.onnx``  (quantized CTC branch, consumed by sherpa-onnx)
- ``tokens.txt``       (CTC vocabulary)
- ``manifest.json``    (checksummed artifact manifest)

License: CC-BY-4.0 (NVIDIA NCSpeech speech models). Verify at
https://huggingface.co/NCSpeech/stt_tl_fastconformer_hybrid_large
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = ROOT / "models" / "artifacts"
MODEL_ID = "ncspeech-tl-fastconformer-hybrid-large"
REPO_ID = "NCSpeech/stt_tl_fastconformer_hybrid_large"
REVISION = "main"
NEMO_FILENAME = "stt_tl_fastconformer_hybrid_large.nemo"
SOURCE = f"https://huggingface.co/{REPO_ID}"


class ExportError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(target: Path, roles: dict[str, str]) -> None:
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
        "id": MODEL_ID,
        "kind": "asr",
        "source": SOURCE,
        "revision": REVISION,
        "license": {"spdx": "CC-BY-4.0"},
        "artifacts": artifacts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def download_nemo(staging: Path) -> Path:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as error:
        raise ExportError("install the 'models' Python extra first") from error
    return Path(
        hf_hub_download(
            repo_id=REPO_ID,
            filename=NEMO_FILENAME,
            revision=REVISION,
            local_dir=staging / "download",
            cache_dir=staging / ".hf-cache",
        )
    )


def export_ctc(nemo_path: Path, staging: Path) -> Path:
    try:
        import nemo.collections.asr as nemo_asr
        import onnx
        import torch
        from onnxruntime.quantization import QuantType, quantize_dynamic
    except ImportError as error:
        raise ExportError(
            "NeMo export requires 'nemo_toolkit[asr]' and 'torch' in a build venv. "
            "Do not add them to the runtime inference venv."
        ) from error
    if not torch.cuda.is_available():
        print("CUDA not detected; export may be slow but still works on CPU.")
    output = staging / "out"
    output.mkdir()

    with torch.no_grad():
        if nemo_path.suffix == ".nemo":
            asr_model = nemo_asr.models.ASRModel.restore_from(str(nemo_path))
        else:
            asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=str(nemo_path))
        decoder_type = "ctc"
        asr_model.change_decoding_strategy(decoder_type=decoder_type)
        asr_model.eval()
        asr_model.set_export_config({"decoder_type": "ctc"})
        asr_model.export(str(output / "model.onnx"))

    model_onnx = output / "model.onnx"
    with open(output / "tokens.txt", "w", encoding="utf-8") as tokens:
        for i, symbol in enumerate(asr_model.joint.vocabulary):
            tokens.write(f"{symbol} {i}\n")
        tokens.write(f"<blk> {len(asr_model.joint.vocabulary)}\n")

    normalize_type = asr_model.cfg.preprocessor.normalize
    if normalize_type == "NA":
        normalize_type = ""
    metadata = {
        "vocab_size": asr_model.decoder.vocab_size,
        "normalize_type": normalize_type,
        "subsampling_factor": 8,
        "model_type": "EncDecHybridRNNTCTCBPEModel",
        "version": "1",
        "model_author": "NeMo",
        "url": SOURCE,
        "comment": "Only the CTC branch is exported",
    }
    onnx_model = onnx.load(model_onnx)
    del onnx_model.metadata_props[:]
    for key, value in metadata.items():
        prop = onnx_model.metadata_props.add()
        prop.key = key
        prop.value = str(value)
    onnx.save(onnx_model, model_onnx)

    quantize_dynamic(
        model_input=str(model_onnx),
        model_output=str(output / "model.int8.onnx"),
        weight_type=QuantType.QUInt8,
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--accept-license",
        action="store_true",
        help="confirm the CC-BY-4.0 NCSpeech model license has been reviewed",
    )
    parser.add_argument(
        "--nemo",
        type=Path,
        help="already-downloaded .nemo archive to use instead of downloading",
    )
    args = parser.parse_args()
    if not args.accept_license:
        raise SystemExit("Pass --accept-license after reviewing the CC-BY-4.0 license.")
    if shutil.which("ffmpeg") is None:
        raise ExportError("ffmpeg is required by NeMo audio decoding")
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        nemo_path = args.nemo or download_nemo(staging)
        if not nemo_path.is_file():
            raise ExportError(f"Nemo archive not found: {nemo_path}")
        output = export_ctc(nemo_path, staging)
        target_staging = staging / MODEL_ID
        target_staging.mkdir()
        for filename in ("model.int8.onnx", "tokens.txt"):
            candidate = output / filename
            if not candidate.is_file():
                raise ExportError(f"export did not produce {filename}")
            shutil.copy2(candidate, target_staging / filename)
        write_manifest(
            target_staging,
            roles={"model": "model.int8.onnx", "tokens": "tokens.txt"},
        )
        destination = ARTIFACT_ROOT / MODEL_ID
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {MODEL_ID}")


if __name__ == "__main__":
    main()
