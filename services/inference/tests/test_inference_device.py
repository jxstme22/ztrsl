"""CUDA runtime fallback (v0.4.2 fix): a GPU present does not mean the CUDA
runtime libraries are installed, so inference must fall back to CPU instead of
failing live start with a missing cublas64_12.dll error."""

import importlib

import pytest

from local_squad_inference.providers import (
    _register_cuda_dll_directory,
    resolve_inference_device,
)


def test_register_cuda_dll_directory_is_noop_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LST_CUDA_LIBS_DIR", raising=False)
    _register_cuda_dll_directory()  # must not raise


def test_register_cuda_dll_directory_is_noop_on_non_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(importlib.import_module("os"), "name", "posix")
    monkeypatch.setenv("LST_CUDA_LIBS_DIR", "/some/cuda/dir")
    _register_cuda_dll_directory()  # must not raise


def test_register_cuda_dll_directory_adds_dir_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    os_mod = importlib.import_module("os")
    added: list[str] = []
    original = getattr(os_mod, "add_dll_directory", None)

    def _fake_add_dll_directory(path: str) -> None:
        added.append(path)

    monkeypatch.setattr(os_mod, "name", "nt")
    monkeypatch.setattr(importlib.import_module("pathlib").Path, "is_dir", lambda self: True)
    monkeypatch.setattr(os_mod, "add_dll_directory", _fake_add_dll_directory, raising=False)
    monkeypatch.setenv("LST_CUDA_LIBS_DIR", r"C:\app\models\cuda12")
    _register_cuda_dll_directory()
    assert added == [r"C:\app\models\cuda12"]
    monkeypatch.undo()
    if original is not None:
        os_mod.add_dll_directory = original  # type: ignore[attr-defined]


def test_cpu_when_cuda_not_probed(monkeypatch: pytest.MonkeyPatch) -> None:
    # Simulate a machine where ctranslate2 reports a GPU but the runtime
    # probe fails (missing cuBLAS): must fall back to CPU.
    class _ProbeFail:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise OSError("cublas64_12.dll not found")

    monkeypatch.delenv("LST_WHISPER_DEVICE", raising=False)
    monkeypatch.delenv("LST_WHISPER_COMPUTE_TYPE", raising=False)
    monkeypatch.setattr(importlib.import_module("platform"), "system", lambda: "Windows")
    monkeypatch.setattr(importlib.import_module("ctranslate2"), "get_cuda_device_count", lambda: 1)
    monkeypatch.setattr(importlib.import_module("ctranslate2"), "Translator", _ProbeFail)

    device, compute = resolve_inference_device(
        "LST_WHISPER_DEVICE",
        "LST_WHISPER_COMPUTE_TYPE",
        cuda_compute="float16",
        cpu_compute="int8",
    )
    assert device == "cpu"
    assert compute == "int8"


def test_cuda_when_runtime_probe_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    class _ProbeOk:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

    monkeypatch.delenv("LST_WHISPER_DEVICE", raising=False)
    monkeypatch.setattr(importlib.import_module("platform"), "system", lambda: "Windows")
    monkeypatch.setattr(importlib.import_module("ctranslate2"), "get_cuda_device_count", lambda: 1)
    monkeypatch.setattr(importlib.import_module("ctranslate2"), "Translator", _ProbeOk)

    device, compute = resolve_inference_device(
        "LST_WHISPER_DEVICE",
        "LST_WHISPER_COMPUTE_TYPE",
        cuda_compute="float16",
        cpu_compute="int8",
    )
    assert device == "cuda"
    assert compute == "float16"


def test_explicit_env_override_is_honored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LST_WHISPER_DEVICE", "cuda")
    monkeypatch.setenv("LST_WHISPER_COMPUTE_TYPE", "float16")
    device, compute = resolve_inference_device(
        "LST_WHISPER_DEVICE",
        "LST_WHISPER_COMPUTE_TYPE",
        cuda_compute="int8",
        cpu_compute="int8",
    )
    assert device == "cuda"
    assert compute == "float16"


def test_non_windows_defaults_to_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LST_WHISPER_DEVICE", raising=False)
    monkeypatch.setattr(importlib.import_module("platform"), "system", lambda: "Darwin")
    device, _ = resolve_inference_device(
        "LST_WHISPER_DEVICE",
        "LST_WHISPER_COMPUTE_TYPE",
        cuda_compute="float16",
        cpu_compute="int8",
    )
    assert device == "cpu"
