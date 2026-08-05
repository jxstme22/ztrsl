# 20 — Models and Download Servers

xTRSNLTR downloads model files only when you choose them, from pinned sources
with SHA-256 verification.

## Recommended models

- **Whisper large-v3-turbo** — speech recognition (faster-whisper). ~1.6 GB.
- **NLLB-200 distilled 600M** — translation (CTranslate2, int8). ~600 MB.
  Runs on CUDA when available, CPU fallback otherwise.

Alternatives: **Whisper large-v3** (full, ~3.1 GB), **MADLAD-400 3B**
(slower CPU translation, selectable), **SenseVoice Small** (multilingual
zh/en/ja/ko/yue ASR via sherpa-onnx, ~239 MB int8, auto language detection),
**FunASR Paraformer zh (streaming)** (Mandarin/English streaming ASR via
sherpa-onnx, ~230 MB int8), and **Omni CTC** / **NCSpeech** CTC exports for
fixed-language recognition.

English→Chinese translation adds **Helsinki opus-mt (en→zh)** — an
Apache-2.0 (commercially usable) Marian model converted to CTranslate2 int8
(~151 MB, `opus-mt-en-zh-ct2-int8`). It installs from the Models page like
any other catalog model: a pinned Hugging Face revision
(`gaudi/opus-mt-en-zh-ctranslate2`, itself an official CTranslate2 conversion
of the Helsinki model) is downloaded file-by-file and SHA-256 verified. It
requires the source language set to English and the output language to
Chinese. `scripts/export_opus_mt_ct2.py` remains available as a manual export
alternative.

## Capabilities and VRAM

Each model card shows its honest language capability (fixed decoder vs.
post-filter) and VRAM class, plus the language profiles it is recommended for.

## Download servers and mirrors

By default downloads use `huggingface.co`. If it is unreachable (e.g. in
mainland China), the app falls through a provider chain:

- Global: `huggingface → hf-mirror.com → modelscope.cn`
- Mainland-CN (`LST_REGION=cn`): `hf-mirror → modelscope → huggingface`
- A custom endpoint you set in the app (or `LST_HF_ENDPOINT` / `HF_ENDPOINT`)
  is tried first.

The **Download server** control lets you choose `hf-mirror.com` explicitly.
Failover happens automatically on transport errors; a download that fails its
checksum always aborts — failover never substitutes a different artifact.

## Offline packs

If you already have the model files (e.g. downloaded elsewhere), install them
with **Install offline model pack** by pointing at a directory containing a
`manifest.json` plus the artifacts. Everything is SHA-256 verified with no
network needed.

## Verified installs

Downloads are staged, checksum-verified, then atomically installed. A partial
or corrupt download never leaves a half-installed model. In-use models are
protected from deletion until you stop the live session.
