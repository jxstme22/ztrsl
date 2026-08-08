# 22 — FAQ

## Is my voice chat uploaded?

**No.** All audio capture, speech recognition, and translation run locally on
your machine. yTRSL has no cloud backend and no telemetry by default.
Optional remote providers (e.g. Groq ASR, LibreTranslate) only send audio when
you explicitly enable them — which requires entering an API key.

## Will Riot/Vanguard ban me for this?

yTRSL does not touch the game process, its memory, its files, or its
packets, and it performs no input automation. It only captures your own audio
output (through Windows audio endpoints or a virtual cable) and draws a normal
top-level transparent window. That keeps it outside Vanguard's scope — but
always use third-party tools responsibly.

## Why is it called a "virtual audio cable"?

To hear *only* the game/party voice, yTRSL can capture the audio your game
plays. A virtual cable (VB-CABLE) routes that audio cleanly. It is a
separately installed driver, never bundled.

## My tag shows as plain text — is that a bug?

No. Tags are rendered as data, never as HTML, so a malicious or quirky tag can
never run code or break the overlay. Plain text is the intended safe behavior.

## Why are there two caption lines?

The overlay shows up to two **source lanes**. When TEAM and DISCORD speak
simultaneously, both appear. You can change this in Settings → Overlay.

## I set Strict mode and lost some captions.

Strict mode suppresses anything that does not match the profile's language. If
your decoder is multilingual (post-filter), it cannot hard-lock, so some real
speech may be filtered — the Models panel labels this honestly. Switch to
Balanced, or use a fixed-language CTC model.

## Do I need a GPU?

No. Everything runs on CPU with CUDA acceleration when a compatible NVIDIA GPU
and models are present. Models choose a resource profile at install.

## Where are models stored?

In the per-user app-data models directory (`%LOCALAPPDATA%\yTRSL\models` on
Windows). You can delete models from the Models panel.

## Can I use it for English-to-English or Mandarin?

Yes — pick the matching source language profile. Mandarin is supported via the
`mandarin` / `chinese_english` profiles and a `zh` target language.

## Can I translate my own voice and typed messages?

Yes. On the History page, the mic toggle translates your own speech in the
reverse direction of the live pair (live en→zh ⇒ you zh→en) into right-aligned
"You" bubbles. The chat box translates typed messages on demand — it works
even without a live session. Pick your mic, language pair, and models in the
config dialog (the sliders icon next to the chat box).

## What is "separated live"?

A second, independent live session of your own voice with its own models,
started from the History config dialog. It shares the loaded model cache with
the main live session (no duplicate model loads) and records into the same
history transcript with the "You" identity.

## Why are my chat messages not appearing?

The chat opens a session on the first message. If nothing appears, check the
session sidebar (the session button in the History toolbar) — the bubble may
be in a newly created session. A live session is only required for the mic
toggle, not for typed chat.

## How is the "You" bubble color chosen?

The History settings menu (Display options) has a "You bubble color" row with
preset swatches; the default is blue. The same color is used for your bubbles
and the "You" badge in the overlay history.
