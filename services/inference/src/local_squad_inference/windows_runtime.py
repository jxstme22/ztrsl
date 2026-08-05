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
"""

from __future__ import annotations

import os
from pathlib import Path


def align_onnxruntime() -> None:
    """Replace sherpa-onnx's bundled onnxruntime DLL with the standalone
    package's copy when they differ. No-op on non-Windows and in packaged
    builds whose DLLs were already aligned by build-sidecar.mjs."""
    if os.name != "nt":
        return
    try:
        import onnxruntime  # noqa: PLC0415 - lazy, Windows-only

        import sherpa_onnx  # noqa: PLC0415, F401 - resolves package location
    except ImportError:
        return
    bundled = Path(sherpa_onnx.__file__).parent / "lib" / "onnxruntime.dll"
    standalone = Path(onnxruntime.__file__).parent / "capi" / "onnxruntime.dll"
    if not bundled.is_file() or not standalone.is_file():
        return
    try:
        if bundled.read_bytes() == standalone.read_bytes():
            return
        bundled.write_bytes(standalone.read_bytes())
    except OSError:
        return
