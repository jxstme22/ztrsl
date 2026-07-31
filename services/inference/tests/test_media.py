from pathlib import Path

import pytest

from local_squad_inference.media import _resolve_media_tool


def test_media_tool_uses_explicit_environment_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executable = tmp_path / "ffmpeg"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    monkeypatch.setenv("LOCAL_SQUAD_FFMPEG", str(executable))
    monkeypatch.setattr("shutil.which", lambda _name: None)

    assert _resolve_media_tool(
        "ffmpeg",
        "LOCAL_SQUAD_FFMPEG",
        common_directories=(),
    ) == str(executable)


def test_media_tool_falls_back_to_common_application_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    executable = tmp_path / "ffprobe"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)
    monkeypatch.delenv("LOCAL_SQUAD_FFPROBE", raising=False)
    monkeypatch.setattr("shutil.which", lambda _name: None)

    assert _resolve_media_tool(
        "ffprobe",
        "LOCAL_SQUAD_FFPROBE",
        common_directories=(tmp_path,),
    ) == str(executable)
