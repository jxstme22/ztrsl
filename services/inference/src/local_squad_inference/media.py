from __future__ import annotations

import json
import shutil
import subprocess
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


class MediaError(RuntimeError):
    pass


@dataclass(frozen=True)
class MediaMetadata:
    display_name: str
    duration_seconds: float
    size_bytes: int
    has_audio: bool


class FfmpegDecoder:
    """Read a user-selected media file as bounded 16 kHz mono f32 chunks."""

    def __init__(self, ffmpeg: str | None = None, ffprobe: str | None = None) -> None:
        self._ffmpeg = ffmpeg or shutil.which("ffmpeg")
        self._ffprobe = ffprobe or shutil.which("ffprobe")
        if self._ffmpeg is None or self._ffprobe is None:
            raise MediaError("FFmpeg and ffprobe are required to analyze media clips")

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
