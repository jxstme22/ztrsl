from __future__ import annotations

import json
import os
import shutil
import subprocess
import wave
from array import array
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16_000
CHUNK_SAMPLES = 4_800
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 2 * 60 * 60
ALLOWED_EXTENSIONS = {
    ".aac",
    ".flac",
    ".m4a",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".wav",
    ".webm",
}
COMMON_MEDIA_TOOL_DIRS = (
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
    Path("/usr/bin"),
)


class MediaError(RuntimeError):
    pass


def _resolve_media_tool(
    name: str,
    environment_key: str,
    *,
    common_directories: tuple[Path, ...] = COMMON_MEDIA_TOOL_DIRS,
) -> str | None:
    configured = os.environ.get(environment_key)
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)

    discovered = shutil.which(name)
    if discovered is not None:
        return discovered

    for directory in common_directories:
        candidate = directory / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


@dataclass(frozen=True)
class MediaMetadata:
    display_name: str
    duration_seconds: float
    size_bytes: int
    has_audio: bool


class FfmpegDecoder:
    """Read a user-selected media file as bounded 16 kHz mono f32 chunks."""

    def __init__(self, ffmpeg: str | None = None, ffprobe: str | None = None) -> None:
        ffmpeg_path = ffmpeg or _resolve_media_tool("ffmpeg", "LOCAL_SQUAD_FFMPEG")
        ffprobe_path = ffprobe or _resolve_media_tool("ffprobe", "LOCAL_SQUAD_FFPROBE")
        if ffmpeg_path is None or ffprobe_path is None:
            raise MediaError(
                "Media decoder unavailable. Install FFmpeg, or set "
                "LOCAL_SQUAD_FFMPEG and LOCAL_SQUAD_FFPROBE."
            )
        self._ffmpeg = ffmpeg_path
        self._ffprobe = ffprobe_path

    def inspect(self, source: Path) -> MediaMetadata:
        resolved = source.expanduser().resolve(strict=True)
        if not resolved.is_file():
            raise MediaError("selected media path is not a file")
        if resolved.suffix.lower() not in ALLOWED_EXTENSIONS:
            raise MediaError("selected file type is not supported")
        size_bytes = resolved.stat().st_size
        if size_bytes > MAX_FILE_BYTES:
            raise MediaError("selected media file exceeds the 2 GiB safety limit")

        completed = subprocess.run(
            [
                self._ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
                str(resolved),
            ],
            check=False,
            capture_output=True,
            timeout=20,
        )
        if completed.returncode != 0:
            raise MediaError("ffprobe could not read the selected media file")
        try:
            probe = json.loads(completed.stdout)
            duration = float(probe["format"]["duration"])
            streams = probe.get("streams", [])
            has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise MediaError("ffprobe returned invalid media metadata") from error
        if not has_audio:
            raise MediaError("selected media file has no audio stream")
        if duration <= 0 or duration > MAX_DURATION_SECONDS:
            raise MediaError("selected media duration is outside the 2-hour safety limit")
        return MediaMetadata(resolved.name, duration, size_bytes, has_audio)

    def chunks(self, source: Path) -> Iterator[tuple[float, ...]]:
        resolved = source.expanduser().resolve(strict=True)
        process = subprocess.Popen(
            [
                self._ffmpeg,
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(resolved),
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "f32le",
                "pipe:1",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if process.stdout is None:
            process.kill()
            raise MediaError("FFmpeg audio pipe was unavailable")
        bytes_per_chunk = CHUNK_SAMPLES * 4
        try:
            while True:
                data = process.stdout.read(bytes_per_chunk)
                if not data:
                    break
                usable = len(data) - (len(data) % 4)
                samples = array("f")
                samples.frombytes(data[:usable])
                if samples.itemsize != 4:
                    raise MediaError("platform float size is unsupported")
                yield tuple(samples)
            return_code = process.wait(timeout=10)
            if return_code != 0:
                raise MediaError("FFmpeg could not decode the selected audio stream")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


class WaveDecoder:
    """Pure-Python WAV decoder — no FFmpeg required.

    New users can try Clip Lab with a `.wav` file even before installing
    FFmpeg. Supports 16-bit PCM mono/stereo at 16 kHz; other formats fall back
    to the FFmpeg decoder when it is available.
    """

    def __init__(self) -> None:
        self._sample_rate = SAMPLE_RATE

    def inspect(self, source: Path) -> MediaMetadata:
        resolved = source.expanduser().resolve(strict=True)
        if not resolved.is_file():
            raise MediaError("selected media path is not a file")
        if resolved.suffix.lower() not in ALLOWED_EXTENSIONS:
            raise MediaError("selected file type is not supported")
        size_bytes = resolved.stat().st_size
        if size_bytes > MAX_FILE_BYTES:
            raise MediaError("selected media file exceeds the 2 GiB safety limit")
        try:
            with wave.open(str(resolved), "rb") as reader:
                sample_rate = reader.getframerate()
                frames = reader.getnframes()
                width = reader.getsampwidth()
        except (wave.Error, OSError, EOFError) as error:
            raise MediaError("not a readable WAV file") from error
        if width != 2:
            raise MediaError("WAV must be 16-bit PCM for the built-in decoder")
        if sample_rate != self._sample_rate:
            raise MediaError(
                f"WAV sample rate must be {self._sample_rate} Hz for the built-in decoder"
            )
        duration = frames / sample_rate
        if duration <= 0 or duration > MAX_DURATION_SECONDS:
            raise MediaError("selected media duration is outside the 2-hour safety limit")
        return MediaMetadata(resolved.name, duration, size_bytes, True)

    def chunks(self, source: Path) -> Iterator[tuple[float, ...]]:
        resolved = source.expanduser().resolve(strict=True)
        with wave.open(str(resolved), "rb") as reader:
            channels = reader.getnchannels()
            while True:
                raw = reader.readframes(CHUNK_SAMPLES)
                if not raw:
                    break
                values = array("h")
                values.frombytes(raw)
                # Convert 16-bit PCM ints to f32 in [-1, 1]; downmix stereo.
                if channels == 1:
                    samples = tuple(value / 32768.0 for value in values)
                else:
                    pairs = zip(values[0::2], values[1::2], strict=True)
                    samples = tuple((left + right) / 2 / 32768.0 for left, right in pairs)
                yield samples
