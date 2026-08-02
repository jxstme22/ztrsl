# Source Notes and Research Snapshot

Checked on **2026-07-29**. Re-verify before implementation and every public release.

## Omnilingual ASR

Official project:

- Meta repository: https://github.com/facebookresearch/omnilingual-asr
- Meta research page: https://ai.meta.com/research/publications/omnilingual-asr-open-source-multilingual-speech-recognition-for-1600-languages/

Relevant points at research time:

- supports more than 1,600 languages;
- model family includes 300M, 1B, 3B, and 7B variants;
- December 2025 update introduced improved v2 CTC/LLM variants;
- exact language IDs, checkpoint names, and licenses must be read from the pinned artifact.

## sherpa-onnx Omnilingual Support

Official documentation:

- https://k2-fsa.github.io/sherpa/onnx/omnilingual-asr/models.html
- https://github.com/k2-fsa/sherpa-onnx

At research time the documented preconverted options included:

- `omniASR_CTC_300M`;
- `omniASR_CTC_300M int8`;
- `omniASR_CTC_1B`;
- `omniASR_CTC_1B int8`.

The documented examples use the offline recognizer and include a VAD + microphone example. Treat low-latency operation as segmented/rolling offline inference unless a truly streaming implementation is later verified.

## MADLAD-400

Official/model documentation:

- https://huggingface.co/google/madlad400-3b-mt
- https://huggingface.co/docs/transformers/en/model_doc/madlad-400
- paper: https://arxiv.org/abs/2309.04662

At research time:

- the 3B MT model card states Apache-2.0;
- it is a multilingual translation model;
- examples use target tokens such as `<2pt>`;
- exact language support and English target behavior must be validated with the pinned model and fixtures;
- Transformers version compatibility must be pinned because APIs evolve.
- In this app it is served by the Rust candle `translation-runner` (CPU only,
  ~50 s per caption) and is selectable, not the default.

## NLLB-200 (default translation)

Official/model documentation:

- upstream: https://huggingface.co/facebook/nllb-200-distilled-600M
- CTranslate2 conversion used in production:
  https://huggingface.co/mijuanlo/nllb-200-distilled-600M-ct2-int8
  (pinned revision `16bc5ff0482f9f1c0d35bdef950721ce58640789`)

Notes:

- license CC-BY-NC-4.0 (non-commercial); acceptance via
  `install_models.py nllb --accept-license`;
- the official `ctranslate2/nllb-200-distilled-600M` repo is gated (HTTP 401);
- community conversion `osa911/nllb-200-distilled-600M-ct2-int8` was rejected:
  its SentencePiece vocabulary contains placeholder tokens (`madeupword0/1`)
  and produced garbage translations;
- lang tokens are injected manually (`tgl_Latn` source prefix, `eng_Latn`
  target prefix); without the source token the model defaults to French;
- use the HF fast tokenizer (`tokenizer.json`), not raw SentencePiece: the
  fast tokenizer appends `</s>` to encoder input, which is required for
  correct output.

## Silero VAD

Official repository:

- https://github.com/snakers4/silero-vad

At research time:

- MIT license;
- supports ONNX;
- intended for fast CPU voice activity detection.

## Tauri

Official documentation:

- https://v2.tauri.app/
- https://v2.tauri.app/learn/window-customization/
- https://v2.tauri.app/reference/javascript/api/namespacewindow/

Tauri supports window customization and transparent windows. Windows-specific click-through/no-activate behavior still requires implementation testing and may need isolated native window-style code.

## Windows Audio

Official Microsoft documentation:

- WASAPI loopback: https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- Microsoft classic sample repository: https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/ApplicationLoopback

WASAPI loopback captures the mix rendered to a chosen render endpoint in shared mode. The V1 architecture uses a dedicated virtual endpoint to isolate voice chat.

## Virtual Audio Cable

Candidate vendor used only as an example:

- https://vb-audio.com/Cable/

At research time VB-CABLE was described as a Windows virtual audio cable and distributed under vendor-specific/donationware terms. Do not rebundle it without explicit redistribution rights. The user should install a signed driver from the official source.

## Riot Policies

Official pages:

- General policies: https://developer.riotgames.com/policies/general
- VALORANT developer policy: https://developer.riotgames.com/docs/valorant
- Third-party application support: https://support.riotgames.com/en-us/riot/events/third-party-applications

At research time:

- products serving players were required to be registered;
- products could not create unfair advantages;
- legal disclaimer requirements existed;
- policies can change.

This documentation is not legal advice. Recheck official policies and contact Riot before public distribution.

## Verification Checklist for Codex

Before pinning any dependency/model:

1. Open official source.
2. Record exact release/tag/commit.
3. Record license.
4. Record artifact filenames and sizes.
5. Calculate SHA-256.
6. Test on Windows.
7. Add to model/dependency manifest.
8. Never rely solely on this planning snapshot.
