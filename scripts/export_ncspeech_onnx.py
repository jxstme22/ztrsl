"""One-time NVIDIA NeMo ASR -> CTC ONNX export (NCSpeech Tagalog / Mandarin).

NVIDIA's ASR checkpoints ship only as PyTorch ``.nemo`` archives, so before
the local provider can decode them with sherpa-onnx we must export the CTC
branch to ONNX once. This tool performs that export and writes a verified
manifest for each supported variant.

Supported variants:

- ``tl`` (default): NCSpeech FastConformer hybrid (Tagalog)
  ``NCSpeech/stt_tl_fastconformer_hybrid_large``
- ``zh``: Citrinet-1024 CTC (Mandarin, AISHELL-2 character vocab)
  ``nvidia/stt_zh_citrinet_1024_gamma_0_25``
- ``zh-parakeet``: Parakeet CTC-XL 0.6B (Mandarin, 17k hours zh-CN/en-US,
  7000-token SentencePiece vocab). Published on NGC under Riva:
  ``nvidia/riva/parakeet-ctc-riva-0-6b-unified-zh-cn`` (NVIDIA Community
  Model License). Fetch it with the NGC CLI:
  ``ngc registry model download-version
  nvidia/riva/parakeet-ctc-riva-0-6b-unified-zh-cn:trainable_v3.0``
  then pass the extracted ``.nemo`` via ``--nemo``.

Requirements (one-time, heavy):

- ``pip install "nemo_toolkit[asr]>=2.0.0" torch`` into a build venv
  (NOT the runtime inference venv; see AGENTS.md dependency pinning).
- ~2-3 GB free disk for torch/nemo plus the ~460-560 MB model archive.

Usage:

    .venv-build\\Scripts\\python scripts\\export_ncspeech_onnx.py --variant tl
    .venv-build\\Scripts\\python scripts\\export_ncspeech_onnx.py --variant zh

Outputs into ``models/artifacts/<model-id>/``:

- ``model.int8.onnx``  (quantized CTC branch, consumed by sherpa-onnx)
- ``tokens.txt``       (CTC vocabulary)
- ``manifest.json``    (checksummed artifact manifest)

License: CC-BY-4.0 (NVIDIA speech models). Verify at
https://huggingface.co/NCSpeech/stt_tl_fastconformer_hybrid_large and
https://huggingface.co/nvidia/stt_zh_citrinet_1024_gamma_0_25
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = ROOT / "models" / "artifacts"

VARIANTS: dict[str, dict[str, str]] = {
    "tl": {
        "model_id": "ncspeech-tl-fastconformer-hybrid-large",
        "repo_id": "NCSpeech/stt_tl_fastconformer_hybrid_large",
        "revision": "main",
        "nemo_filename": "stt_tl_fastconformer_hybrid_large.nemo",
        "model_type": "EncDecHybridRNNTCTCBPEModel",
        "license": "CC-BY-4.0",
    },
    "zh": {
        "model_id": "ncspeech-zh-citrinet-1024-gamma",
        "repo_id": "nvidia/stt_zh_citrinet_1024_gamma_0_25",
        "revision": "main",
        "nemo_filename": "stt_zh_citrinet_1024_gamma_0_25.nemo",
        "model_type": "EncDecCTCModel",
        "license": "CC-BY-4.0",
    },
    "zh-parakeet": {
        "model_id": "ncspeech-zh-parakeet-ctc-0.6b",
        "repo_id": "nvidia/riva/parakeet-ctc-riva-0-6b-unified-zh-cn",
        "revision": "trainable_v3.0",
        "nemo_filename": "Parakeet-Hybrid-XL-unified-0.6b_spe7k_zh-en-CN_3.0.nemo",
        "model_type": "EncDecHybridRNNTCTCBPEModel",
        "license": "NVIDIA Community Model License",
        "source_url": "https://catalog.ngc.nvidia.com/orgs/nvidia/models/parakeet-ctc-riva-0-6b-unified-zh-cn",
    },
}


class ExportError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(target: Path, roles: dict[str, str], variant: dict[str, str]) -> None:
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
        "id": variant["model_id"],
        "kind": "asr",
        "source": variant.get("source_url", f"https://huggingface.co/{variant['repo_id']}"),
        "revision": variant["revision"],
        "license": {"spdx": variant["license"]},
        "artifacts": artifacts,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def download_nemo(staging: Path, variant: dict[str, str]) -> Path:
    try:
        from huggingface_hub import hf_hub_download, list_repo_files
    except ImportError as error:
        raise ExportError("install the 'models' Python extra first") from error
    filename = variant["nemo_filename"]
    if not filename:
        files = list_repo_files(repo_id=variant["repo_id"], revision=variant["revision"])
        candidates = [candidate for candidate in files if candidate.endswith(".nemo")]
        if not candidates:
            raise ExportError(f"no .nemo archive found in {variant['repo_id']}")
        filename = candidates[0]
        print(f"Discovered archive in repo: {filename}")
    return Path(
        hf_hub_download(
            repo_id=variant["repo_id"],
            filename=filename,
            revision=variant["revision"],
            local_dir=staging / "download",
            cache_dir=staging / ".hf-cache",
        )
    )


def export_ctc(nemo_path: Path, staging: Path, variant: dict[str, str]) -> Path:
    try:
        import nemo.collections.asr as nemo_asr
        import torch
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
        try:
            asr_model.change_decoding_strategy(decoder_type=decoder_type)
        except TypeError:
            # Pure-CTC models (Citrinet) in NeMo >= 2.7 take a decoding config
            # instead of a decoder_type keyword; their decoding is already CTC.
            asr_model.change_decoding_strategy(decoding_cfg={"decoding_type": "greedy"})
        asr_model.eval()
        asr_model.set_export_config({"decoder_type": "ctc"})
        asr_model.export(str(output / "model.onnx"))

        # Hybrid models expose the CTC vocabulary on `joint`; pure-CTC models
        # (Citrinet) expose it on `decoder`.
        if hasattr(asr_model, "joint"):
            vocabulary = asr_model.joint.vocabulary
        else:
            vocabulary = asr_model.decoder.vocabulary

    model_onnx = output / "model.onnx"
    with open(output / "tokens.txt", "w", encoding="utf-8") as tokens:
        for i, symbol in enumerate(vocabulary):
            tokens.write(f"{symbol} {i}\n")
        tokens.write(f"<blk> {len(vocabulary)}\n")

    normalize_type = asr_model.cfg.preprocessor.normalize
    if normalize_type == "NA":
        normalize_type = ""
    metadata = {
        "vocab_size": len(vocabulary),
        "normalize_type": normalize_type,
        "subsampling_factor": 8,
        "model_type": variant["model_type"],
        "version": "1",
        "model_author": "NeMo",
        "url": variant.get("source_url", f"https://huggingface.co/{variant['repo_id']}"),
        "comment": "Only the CTC branch is exported",
    }
    quant_onnx = output / "model.int8.onnx"
    # Quantization must run in a fresh interpreter: NeMo's fp32 export uses
    # external-data tensors and torch/nemo stay resident here, so a same-
    # process quantize_dynamic of large checkpoints can exhaust memory and
    # crash with an access violation. A helper subprocess loads only onnx/
    # onnxruntime and also attaches metadata to the small int8 model (the
    # fp32 graph exceeds protobuf's 2 GB serialization limit).
    helper = r"""
import json, sys
import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic

src, dst, metadata_json = sys.argv[1], sys.argv[2], sys.argv[3]
quantize_dynamic(model_input=src, model_output=dst, weight_type=QuantType.QUInt8)
model = onnx.load(dst)
del model.metadata_props[:]
for key, value in json.loads(metadata_json).items():
    prop = model.metadata_props.add()
    prop.key = key
    prop.value = str(value)
onnx.save(model, dst)
print(f"quantized {src} -> {dst}")
"""
    subprocess.run(
        [sys.executable, "-c", helper, str(model_onnx), str(quant_onnx), json.dumps(metadata)],
        check=True,
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--variant",
        choices=sorted(VARIANTS),
        default="tl",
        help="which NeMo checkpoint to export (default: tl)",
    )
    parser.add_argument(
        "--accept-license",
        action="store_true",
        help="confirm the CC-BY-4.0 NVIDIA model license has been reviewed",
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
    variant = VARIANTS[args.variant]
    model_id = variant["model_id"]
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ARTIFACT_ROOT) as temporary:
        staging = Path(temporary)
        nemo_path = args.nemo or download_nemo(staging, variant)
        if not nemo_path.is_file():
            raise ExportError(f"Nemo archive not found: {nemo_path}")
        output = export_ctc(nemo_path, staging, variant)
        target_staging = staging / model_id
        target_staging.mkdir()
        for filename in ("model.int8.onnx", "tokens.txt"):
            candidate = output / filename
            if not candidate.is_file():
                raise ExportError(f"export did not produce {filename}")
            shutil.copy2(candidate, target_staging / filename)
        write_manifest(
            target_staging,
            roles={"model": "model.int8.onnx", "tokens": "tokens.txt"},
            variant=variant,
        )
        destination = ARTIFACT_ROOT / model_id
        if destination.exists():
            shutil.rmtree(destination)
        target_staging.replace(destination)
    print(f"Installed and verified {model_id}")


if __name__ == "__main__":
    main()
