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


def test_wave_decoder_reads_16khz_pcm_wav(tmp_path: Path) -> None:
    """v0.3 regression: new users without FFmpeg can use Clip Lab with WAV."""
    import wave

    from local_squad_inference.media import WaveDecoder

    source = tmp_path / "comms.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes((b"\x00\x00" * 8000) + (b"\xff\x7f" * 8000))

    decoder = WaveDecoder()
    metadata = decoder.inspect(source)
    assert metadata.duration_seconds == pytest.approx(1.0)
    assert metadata.has_audio is True

    chunks = list(decoder.chunks(source))
    assert chunks, "wav decoder should produce audio chunks"


def test_wave_decoder_rejects_wrong_sample_rate(tmp_path: Path) -> None:
    import wave

    from local_squad_inference.media import MediaError, WaveDecoder

    source = tmp_path / "bad.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(44_100)
        output.writeframes(b"\x00\x00" * 100)

    with pytest.raises(MediaError):
        WaveDecoder().inspect(source)
