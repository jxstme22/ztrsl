import hashlib
import json
from pathlib import Path

import pytest

from local_squad_inference.providers import ModelUnavailableError, verify_manifest


def test_manifest_accepts_an_exact_artifact(tmp_path: Path) -> None:
    artifact = tmp_path / "model.onnx"
    artifact.write_bytes(b"safe model bytes")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "role": "model",
                        "path": artifact.name,
                        "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    assert verify_manifest(tmp_path, manifest)["artifacts"]


def test_manifest_rejects_corrupt_and_escaping_artifacts(tmp_path: Path) -> None:
    artifact = tmp_path / "model.onnx"
    artifact.write_bytes(b"corrupt")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "role": "model",
                        "path": artifact.name,
                        "sha256": "0" * 64,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ModelUnavailableError, match="checksum"):
        verify_manifest(tmp_path, manifest)

    manifest.write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "role": "model",
                        "path": "../outside.onnx",
                        "sha256": "0" * 64,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ModelUnavailableError, match="escapes"):
        verify_manifest(tmp_path, manifest)
