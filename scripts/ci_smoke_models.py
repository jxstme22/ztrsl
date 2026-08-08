"""CI smoke test for the new catalog models on Windows.

Downloads the real model artifacts at their pinned catalog revisions, writes
verified manifests, then runs the actual sidecar providers. A native crash in
sherpa-onnx/onnxruntime/ctranslate2/sentencepiece kills this process; the
faulthandler trace lands on stderr, which the CI log surfaces.

Usage:
    python scripts/ci_smoke_models.py [sensevoice|opus-en-zh|all]

Runs in the repo venv after `uv sync --extra dev --extra models`.
"""

from __future__ import annotations

import argparse
import faulthandler
import hashlib
import json
import os
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

faulthandler.enable()

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "inference" / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def dll_sha(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    except OSError:
        return "<missing>"


from local_squad_inference.windows_runtime import align_onnxruntime  # noqa: E402

aligned = align_onnxruntime()
log(f"[diag] alignment ran: {aligned}")

import importlib.util  # noqa: E402

for pkg in ("onnxruntime", "sherpa_onnx"):
    spec = importlib.util.find_spec(pkg)
    if spec is None:
        log(f"[diag] {pkg}: spec not found")
        continue
    locations = list(spec.submodule_search_locations or [])
    log(f"[diag] {pkg}: {locations}")
    if locations:
        base = Path(locations[0])
        if pkg == "sherpa_onnx":
            lib_dir = base / "lib"
            for dll in sorted(lib_dir.glob("*.dll")) if lib_dir.is_dir() else []:
                log(f"[diag]   {dll.name} {dll.stat().st_size} {dll_sha(dll)}")
        else:
            capi = base / "capi" / "onnxruntime.dll"
            log(f"[diag]   capi/onnxruntime.dll {dll_sha(capi)}")

import onnxruntime as _ort  # noqa: E402

log(f"[diag] onnxruntime module version: {_ort.__version__}")

spec = importlib.util.find_spec("sherpa_onnx")
if spec is not None and spec.submodule_search_locations:
    lib_dir = Path(next(iter(spec.submodule_search_locations))) / "lib"
    if lib_dir.is_dir():
        for dll in sorted(lib_dir.glob("*.dll")):
            log(f"[diag] post-alignment {dll.name} {dll.stat().st_size} {dll_sha(dll)}")

import ctypes  # noqa: E402

loaded = ctypes.WinDLL("onnxruntime.dll") if os.name == "nt" else None
if loaded is not None:
    buf = ctypes.create_unicode_buffer(1024)
    ctypes.windll.kernel32.GetModuleFileNameW(ctypes.c_void_p(loaded._handle), buf, len(buf))
    log(f"[diag] loaded onnxruntime.dll: {buf.value}")
    ctypes.windll.kernel32.FreeLibrary(ctypes.c_void_p(loaded._handle))

HF = "https://huggingface.co"

SENSEVOICE = {
    "id": "sensevoice-small",
    "source": "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
    "revision": "2365baeacb507f821a0c8120fcee3d484dba7a07",
    "files": [
        (
            "model.int8.onnx",
            239233841,
            "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
            "model",
        ),
        (
            "tokens.txt",
            315894,
            "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
            "tokens",
        ),
    ],
}

OPUS_EN_ZH = {
    "id": "opus-mt-en-zh-ct2-int8",
    "source": "gaudi/opus-mt-en-zh-ctranslate2",
    "revision": "dcd22168f08b99dd34c62bc2195e31dc2f04e90b",
    "files": [
        (
            "model.bin",
            155502615,
            "f24c2bb82368f7de0196882de1d8b644d2aa54ae2439c3142f263de8a64ea2a9",
            "model",
        ),
        (
            "config.json",
            215,
            "ce02c0c0d02f285d2ff34c80b0867ccb5c4a3b250a275e6d1d2884f5499a6e46",
            "config",
        ),
        (
            "shared_vocabulary.json",
            1303887,
            "37314a6abb25ed8f8497498aeeb31fcea98de892bf00ff7c2e8c966b26fe0b82",
            "vocabulary",
        ),
        (
            "source.spm",
            806435,
            "5775ddc9e3ff2fae91554da56468ad35ff56edaba870fea74447bc7234bfdaa8",
            "source_spm",
        ),
        (
            "target.spm",
            804600,
            "81dc94efa84e4025ef38d25d5d07429fe41e3eb29d44003f1db6fe98487b0052",
            "target_spm",
        ),
    ],
}


def download(url: str, dest: Path, expected_sha256: str) -> None:
    if dest.is_file() and hashlib.sha256(dest.read_bytes()).hexdigest() == expected_sha256:
        print(f"  cached {dest.name}")
        return
    size_on_disk = dest.stat().st_size if dest.exists() else 0
    print(f"  downloading {dest.name} ({size_on_disk} bytes on disk)")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=300) as response, dest.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            break
        except Exception as error:
            print(f"  attempt {attempt + 1} failed: {error}")
            time.sleep(2)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if digest != expected_sha256:
        raise SystemExit(f"checksum mismatch for {dest.name}: {digest}")


def prepare(spec: dict, workdir: Path) -> Path:
    print(f"== {spec['id']} ==")
    model_dir = workdir / spec["id"]
    model_dir.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for name, size, sha, role in spec["files"]:
        url = f"{HF}/{spec['source']}/resolve/{spec['revision']}/{name}"
        download(url, model_dir / name, sha)
        artifacts.append({"role": role, "path": name, "size_bytes": size, "sha256": sha})
    manifest = {
        "schema_version": 1,
        "id": spec["id"],
        "kind": "asr" if "sensevoice" in spec["id"] else "translation",
        "runtime": "sherpa-onnx" if "sensevoice" in spec["id"] else "ctranslate2",
        "source": f"https://huggingface.co/{spec['source']}",
        "revision": spec["revision"],
        "license": {"spdx": "Apache-2.0"},
        "artifacts": artifacts,
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return model_dir


def smoke_sensevoice(model_dir: Path) -> None:
    from local_squad_inference.providers import SenseVoiceProvider
    from local_squad_inference.vad import AudioUtterance

    provider = SenseVoiceProvider(model_dir)
    # 0.5 s of 220 Hz tone at 16 kHz — proves model load + native decode.
    import math

    samples = tuple(math.sin(2 * math.pi * 220 * i / 16_000) * 0.2 for i in range(8_000))
    result = provider.transcribe(
        AudioUtterance(
            utterance_id="ci-1",
            pcm_f32=samples,
            sample_rate=16_000,
            started_ns=0,
            ended_ns=500_000_000,
            is_final=True,
            forced_end=True,
        ),
        source_mode="chinese",
    )
    print(f"  decoded: {result.text!r} (model {result.model_id})")


def smoke_opus(model_dir: Path) -> None:
    from local_squad_inference.providers import OpusMtEnZhProvider

    provider = OpusMtEnZhProvider(model_dir)
    print(f"  runtime: {provider.runtime_detail}")
    result = provider.translate(
        type(
            "R",
            (),
            {
                "utterance_id": "ci-2",
                "source_mode": "english",
                "text": "Hello, this is a test message.",
            },
        )()
    )
    print(f"  translated: {result.english_text!r} (model {result.model_id})")


PARAFORMER = {
    "id": "paraformer-zh-streaming",
    "source": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2",
    "revision": "2024-03-10",
    "archive_size": 1047319737,
    "archive_sha256": "5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f",
    "files": [
        (
            "encoder.int8.onnx",
            165462184,
            "81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a",
            "encoder",
        ),
        (
            "decoder.int8.onnx",
            71664561,
            "f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f",
            "decoder",
        ),
        (
            "tokens.txt",
            75756,
            "59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6",
            "tokens",
        ),
    ],
}


def prepare_paraformer(workdir: Path) -> Path:
    print("== paraformer-zh-streaming ==")
    model_dir = workdir / PARAFORMER["id"]
    model_dir.mkdir(parents=True, exist_ok=True)
    archive_path = model_dir / "model.tar.bz2"
    archive_ok = (
        archive_path.is_file()
        and hashlib.sha256(archive_path.read_bytes()).hexdigest() == PARAFORMER["archive_sha256"]
    )
    if not archive_ok:
        print(f"  downloading {PARAFORMER['source'].split('/')[-1]} (1 GB)")
        for attempt in range(3):
            try:
                with (
                    urllib.request.urlopen(PARAFORMER["source"], timeout=900) as response,
                    archive_path.open("wb") as out,
                ):
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                break
            except Exception as error:
                print(f"  attempt {attempt + 1} failed: {error}")
                time.sleep(2)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if digest != PARAFORMER["archive_sha256"]:
        raise SystemExit(f"checksum mismatch for archive: {digest}")
    with tarfile.open(archive_path, "r:bz2") as tar:
        for name, _size, sha, _role in PARAFORMER["files"]:
            member = None
            for m in tar.getmembers():
                if m.name.endswith("/" + name):
                    member = m
                    break
            if member is None:
                raise SystemExit(f"archive member {name} not found")
            extracted = tar.extractfile(member)
            if extracted is None:
                raise SystemExit(f"archive member {name} not extractable")
            data = extracted.read()
            if hashlib.sha256(data).hexdigest() != sha:
                raise SystemExit(f"checksum mismatch for {name}")
            (model_dir / name).write_bytes(data)
    artifacts = [
        {"role": role, "path": name, "size_bytes": size, "sha256": sha}
        for name, size, sha, role in PARAFORMER["files"]
    ]
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": PARAFORMER["id"],
                "kind": "asr",
                "runtime": "sherpa-onnx",
                "source": "https://github.com/k2-fsa/sherpa-onnx/releases",
                "revision": PARAFORMER["revision"],
                "license": {"spdx": "Apache-2.0"},
                "artifacts": artifacts,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return model_dir


def smoke_paraformer(model_dir: Path) -> None:
    from local_squad_inference.providers import StreamingParaformerProvider
    from local_squad_inference.vad import AudioUtterance

    provider = StreamingParaformerProvider(model_dir)
    import math

    samples = tuple(math.sin(2 * math.pi * 220 * i / 16_000) * 0.2 for i in range(8_000))
    result = provider.transcribe(
        AudioUtterance(
            utterance_id="ci-3",
            pcm_f32=samples,
            sample_rate=16_000,
            started_ns=0,
            ended_ns=500_000_000,
            is_final=True,
            forced_end=True,
        ),
        source_mode="chinese",
    )
    print(f"  decoded: {result.text!r} (model {result.model_id})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "target",
        nargs="?",
        default="all",
        choices=["sensevoice", "paraformer", "opus-en-zh", "all"],
    )
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="ci-models-") as tmp:
        workdir = Path(tmp)
        if args.target in ("sensevoice", "all"):
            model_dir = prepare(SENSEVOICE, workdir)
            smoke_sensevoice(model_dir)
        if args.target in ("paraformer", "all"):
            model_dir = prepare_paraformer(workdir)
            smoke_paraformer(model_dir)
        if args.target in ("opus-en-zh", "all"):
            model_dir = prepare(OPUS_EN_ZH, workdir)
            smoke_opus(model_dir)
    print("SMOKE OK")


if __name__ == "__main__":
    main()
