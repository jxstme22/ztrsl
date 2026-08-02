"""Download an NVIDIA NGC model artifact (.nemo) via the NGC v2 API.

The Mandarin Parakeet CTC checkpoint is published only on NGC
(``nvidia/parakeet-ctc-0.6b-zh-cn``), not Hugging Face, so the export
pipeline cannot use ``huggingface_hub`` for it. This tool fetches the
archive with an NGC API key (free account at https://ngc.nvidia.com,
Setup > Generate API Key) and then hands the file to
``scripts/export_ncspeech_onnx.py --nemo <path>``.

Usage:

    python scripts/download_ngc_model.py --api-key <key> \\
        --collection nvidia/parakeet-ctc-0.6b-zh-cn --output models/staging

The key is passed on the command line only; it is never written to disk.
"""

from __future__ import annotations

import argparse
import hashlib
import urllib.request
from pathlib import Path

API_ROOT = "https://api.ngc.nvidia.com/v2"


class NgcError(RuntimeError):
    pass


def _json(url: str, api_key: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            import json

            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise NgcError(
            f"NGC API {error.code} for {url}: {error.reason} "
            "(check the API key and collection name)"
        ) from error


def find_nemo(url: str, api_key: str) -> tuple[str, str, int]:
    """Return (download_url, filename, size_bytes) of the .nemo artifact."""
    collection = _json(url, api_key)
    for entry in collection.get("entries", []):
        artifact = entry.get("artifact", {})
        name = artifact.get("name", "")
        if name.endswith(".nemo"):
            version_id = entry.get("versionId", "")
            path = artifact.get("path", "")
            size = int(artifact.get("size", 0) or 0)
            download_url = (
                f"{url}/versions/{version_id}/files/{path}" if path else ""
            )
            return download_url, name, size
    raise NgcError(f"no .nemo artifact found in {url}")


def download(url: str, api_key: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}"})
    with (
        urllib.request.urlopen(request, timeout=600) as response,
        destination.open("wb") as output,
    ):
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)
    print(f"Downloaded {destination} ({destination.stat().st_size / 1e9:.2f} GB)")
    print(f"sha256: {digest.hexdigest()}")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-key", required=True, help="NGC API key (never persisted)")
    parser.add_argument(
        "--collection",
        default="nvidia/parakeet-ctc-0.6b-zh-cn",
        help="NGC collection path (default: Mandarin Parakeet CTC 0.6B)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("models/staging"),
        help="directory to write the .nemo archive into",
    )
    args = parser.parse_args()

    collection_url = f"{API_ROOT}/orgs/{args.collection}"
    download_url, filename, expected_size = find_nemo(collection_url, args.api_key)
    if not download_url:
        raise NgcError(f"artifact has no direct path in {args.collection}")
    print(f"Artifact: {filename} ({expected_size / 1e9:.2f} GB expected)")
    if expected_size and expected_size < 100_000_000:
        raise NgcError(f"artifact looks too small ({expected_size} bytes); aborting")
    destination = download(download_url, args.api_key, args.output / filename)
    print(
        "Next: python scripts/export_ncspeech_onnx.py "
        f"--variant zh-parakeet --accept-license --nemo {destination}"
    )


if __name__ == "__main__":
    main()
