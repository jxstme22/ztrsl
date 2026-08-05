"""Windows runtime alignment for the onnxruntime version clash.

Two independent Windows hazards can make sherpa-onnx model loads crash with
an access violation ("The requested API version [27] is not available, only
API versions [1, 17] are supported in this build. Current ORT Version is:
1.17.1"), killing the sidecar (surfaced as a 10054 WebSocket drop):

1. sherpa-onnx 1.13.4's ``_sherpa_onnx`` binding is compiled against
   onnxruntime API 27 (1.27.0), but its companion ``sherpa-onnx-core`` wheel
   ships a 1.17.1 copy of ``onnxruntime.dll`` inside ``sherpa_onnx/lib``;
2. a stale ``onnxruntime.dll`` can exist in ``C:\\Windows\\SYSTEM32``
   (installed by other software / CI runner images). Windows resolves
   implicitly-imported ``onnxruntime.dll`` by name: application dir,
   System32, then added DLL directories — so the binding (and the
   onnxruntime python package itself) can grab the System32 copy even when
   the venv has a correct 1.27.0.

The fix loads the standalone ``onnxruntime`` package's DLL by FULL PATH
before anything imports onnxruntime or sherpa_onnx. Full-path loads bypass
the name-based search, and Windows reuses an already-loaded module for
later name-based loads — so the binding ends up on the matching 1.27.0
build. The bundled sherpa copy is also replaced with the standalone DLL
when present.

CRITICAL: call this BEFORE ``import onnxruntime`` and
``import sherpa_onnx``. ``importlib.util.find_spec`` locates packages
without executing them.
"""

from __future__ import annotations

import contextlib
import ctypes
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
    """Ensure ``onnxruntime.dll`` resolves to the standalone package's copy.
    Must run before ``import onnxruntime`` / ``import sherpa_onnx``.

    Returns True when the standalone DLL was loaded; False on non-Windows or
    when it could not be resolved.
    """
    if os.name != "nt":
        return False
    try:
        ort_dir = _package_dir("onnxruntime")
        sherpa_dir = _package_dir("sherpa_onnx")
        if ort_dir is None:
            return False
        standalone = ort_dir / "capi" / "onnxruntime.dll"
        if not standalone.is_file():
            return False

        # Hazard 1: replace the bundled sherpa copy when present.
        if sherpa_dir is not None:
            bundled = sherpa_dir / "lib" / "onnxruntime.dll"
            try:
                if bundled.is_file() and bundled.read_bytes() != standalone.read_bytes():
                    bundled.write_bytes(standalone.read_bytes())
            except OSError:
                pass

        # Hazard 2: register the standalone's directory and load it by full
        # path so every later name-based load reuses this copy.
        add_dll_directory = getattr(os, "add_dll_directory", None)
        if add_dll_directory is not None:
            with contextlib.suppress(OSError):
                add_dll_directory(str(standalone.parent))
        ctypes_win = ctypes if hasattr(ctypes, "WinDLL") else None
        if ctypes_win is None:
            return False
        kernel32 = ctypes_win.WinDLL("kernel32", use_last_error=True)
        load_library_ex = kernel32.LoadLibraryExW
        load_library_ex.restype = ctypes.c_void_p
        load_library_ex.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_uint32]
        LOAD_WITH_ALTERED_SEARCH_PATH = 0x00000008
        handle = load_library_ex(str(standalone), None, LOAD_WITH_ALTERED_SEARCH_PATH)
        return bool(handle)
    except (OSError, ValueError, AttributeError):
        return False
