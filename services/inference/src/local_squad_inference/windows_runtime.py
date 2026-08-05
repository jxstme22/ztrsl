"""Windows runtime alignment for the onnxruntime version clash.

sherpa-onnx 1.13.4's ``_sherpa_onnx`` binding is compiled against onnxruntime
API 27 (1.27.0), but its companion ``sherpa-onnx-core`` wheel ships a
1.17.1 copy of ``onnxruntime.dll`` inside ``sherpa_onnx/lib``. Because
Windows resolves ``onnxruntime.dll`` from the loading module's own directory
first, the binding grabs the 1.17.1 copy and dies with an access violation
("The requested API version [27] is not available ... Current ORT Version
is: 1.17.1") on the first model load — surfaced by the desktop as a
10054 WebSocket drop.

The fix aligns the process on a single onnxruntime: the bundled 1.17.1 copy
is replaced by the standalone ``onnxruntime`` package's 1.27.0 DLL, which the
binding actually expects. Every onnxruntime user (Silero VAD, sherpa-onnx)
then shares the same 1.27.0 build.

CRITICAL: the replacement must happen BEFORE ``sherpa_onnx`` is imported —
importing the package loads the pyd, and Windows binds its
``onnxruntime.dll`` reference at load time from the pyd's own directory.
``importlib.util.find_spec`` locates the packages without executing them.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def _package_dir(name: str) -> Path | None:
    spec = importlib.util.find_spec(name)
    if spec is None or spec.submodule_search_locations is None:
        return None
    locations = list(spec.submodule_search_locations)
    if not locations:
        return None
    return Path(locations[0])


def align_onnxruntime() -> bool:
    """Replace sherpa-onnx's bundled onnxruntime DLL with the standalone
    package's copy when they differ. Must run before ``import sherpa_onnx``.

    Returns True when a replacement was performed (or the copies already
    matched); False when nothing could be verified (non-Windows, packages
    missing, or the replacement failed).
    """
    if os.name != "nt":
        return False
    try:
        sherpa_dir = _package_dir("sherpa_onnx")
        ort_dir = _package_dir("onnxruntime")
        if sherpa_dir is None or ort_dir is None:
            return False
        bundled = sherpa_dir / "lib" / "onnxruntime.dll"
        standalone = ort_dir / "capi" / "onnxruntime.dll"
        if not bundled.is_file() or not standalone.is_file():
            return False
        if bundled.read_bytes() == standalone.read_bytes():
            return True
        bundled.write_bytes(standalone.read_bytes())
        return True
    except (OSError, ValueError):
        return False
