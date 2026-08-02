# ASR and Translation Pipeline

## 1. Pipeline

```mermaid
flowchart LR
  A[16 kHz mono frames] --> B[Stateful Silero VAD]
  B --> C[Utterance manager]
  C --> D[Faster-Whisper large-v3]
  D --> E[Text normalizer]
  E --> F[Stable-prefix tracker]
  F --> G[Protected-term masker]
  G --> H[MADLAD-400 translation]
  H --> I[Term restoration]
  I --> J[Caption formatter]
```

## 2. Model Baseline

### VAD

Silero VAD ONNX.

Run on CPU. Do not reserve GPU for VAD.

Initial tuning values:

```yaml
sample_rate: 16000
frame_ms: 30
speech_threshold: 0.55
min_speech_ms: 180
pre_roll_ms: 180
min_silence_ms: 450
max_utterance_ms: 12000
```

These are starting values, not fixed truths.

### ASR

V1 default (ADR-012):

```text
Faster-Whisper large-v3, language=tl, CUDA FP16, beam size 5
```

Fallback candidate:

```text
Faster-Whisper large-v3-turbo
```

The model is segment-based, not a native streaming transducer. Live behavior comes from stateful
VAD segmentation, bounded utterances, and one inference job at a time. Omnilingual checkpoints
remain research candidates for Cebuano and comparison benchmarks.

### Translation

Default family (ADR-002, updated with near-real-time default):

```text
facebook/nllb-200-distilled-600M
```

Served locally via CTranslate2 (`mijuanlo/nllb-200-distilled-600M-ct2-int8`,
pinned revision, int8; CUDA when available, CPU fallback). ~600 MB, tens of ms
per caption on CUDA. Language tokens are injected manually because CTranslate2
`translate_batch` has no `source_lang_code`/`target_lang_code` kwargs: source is
prefixed with `tgl_Latn` and the target prefix is `eng_Latn`. The HF fast
tokenizer (`tokenizer.json`) must be used instead of raw SentencePiece — the
fast tokenizer appends `</s>` to encoder input, which SentencePiece does not.
License CC-BY-NC-4.0 (non-commercial).

Selectable legacy default:

```text
google/madlad400-3b-mt
```

Served by the Rust candle translation-runner on CPU only, ~50 s per caption.
Kept selectable for offline use without a local translation model or as a
reference benchmark.

Target English token (MADLAD path only):

```text
<2en>
```

The exact source-language prompting and model behavior must be verified with the pinned checkpoint and fixtures. Never infer language tags from memory when wiring production code.

## 3. Source Modes

```typescript
type SourceMode =
  | "filipino"
  | "cebuano"
  | "mixed"
  | "english"
  | "auto";
```

V1 live UI exposes Filipino / Tagalog and Taglish. Cebuano/Bislish and automatic multilingual mode
remain disabled until a native-speaker benchmark passes.

Internal English mode is useful for tests and untranslated captions.

## 4. Utterance Manager

Maintain:

- pre-roll;
- active speech buffer;
- post-speech hangover;
- maximum duration;
- monotonic timestamps;
- sequence gaps;
- forced split context.

When maximum duration is reached, split at the best recent silence. If none exists:

- force a split;
- mark `forced_end=true`;
- retain a short overlap for the next segment;
- deduplicate text across segment boundaries.

## 5. Provisional Decode Policy

Do not decode every frame.

Initial schedule:

- first decode after 700–1,000 ms of speech;
- subsequent decode every 450–700 ms;
- skip if less than a minimum amount of new audio;
- cancel queued stale provisional jobs when a newer one exists;
- never run more than one ASR job concurrently in the default profile.

A provisional utterance may be decoded on the complete accumulated audio, bounded by maximum window size.

## 6. Stable Prefix

Given hypotheses:

```text
H1: adto ta b
H2: adto ta b kay naa
H3: adto ta b kay naa sila
```

Compute the longest normalized prefix stable across a configured number of revisions.

Track both:

- stable source prefix;
- unstable source suffix.

Translate at phrase boundaries, not per word.

A new provisional translation is justified when:

- stable prefix grows by at least 3 words;
- punctuation/clause heuristic fires;
- elapsed time exceeds maximum preview wait;
- finalization occurs.

## 7. Text Normalization

Conservative only:

- Unicode normalization;
- whitespace;
- obvious repeated-token cleanup;
- casing mode;
- punctuation model only if separately validated;
- profanity must not be silently censored unless user chooses filtering.

Do not “correct” names or tactical terms using an LLM in V1.

## 8. Code-Switching

Examples:

```text
Adto ta B, they used smoke already.
Wait lang, I'm rotating.
Dito ka muna sa heaven.
```

Requirements:

- preserve recognized English spans where possible;
- avoid retranslating official game vocabulary;
- evaluate mixed speech as a separate benchmark category;
- do not rely solely on utterance-level language detection.

Heuristic layer may calculate:

- English-token ratio;
- glossary-token ratio;
- source-mode prior;
- script consistency;
- model confidence where available.

The heuristic must not claim linguistic certainty. It selects processing strategy.

## 9. Terminology Protection

Maintain versioned glossary groups:

```text
core_english_gaming
valorant_agents
valorant_weapons
map_locations
friend_names_optional
custom_user_terms
```

Never scrape or infer hidden game state. Glossary data is static/user-supplied.

Masking example:

```text
Input: "adto ta sa A site kay naa si Jett"
Masked: "adto ta sa __TERM_001__ kay naa si __TERM_002__"
Translate
Restore exact configured forms
```

Mask format must be robust against tokenizer splitting and translation mutation. Test multiple placeholder schemes.

## 10. Translation Triggering

### Provisional

Translate only stable clause/prefix. Keep one active provisional translation per utterance.

### Final

At end of speech:

1. run final ASR on complete utterance;
2. normalize;
3. protect terms;
4. translate;
5. restore terms;
6. compare with provisional;
7. emit final caption;
8. close correction window.

## 11. English-Only Handling

If source is mostly English:

- show original English as final caption;
- optionally apply conservative punctuation;
- skip MT;
- report `translation_skipped_reason=already_english`.

Avoid forcing every phrase through multilingual MT.

## 12. Inference Provider Interfaces

```python
@dataclass(frozen=True)
class AudioUtterance:
    utterance_id: str
    pcm_f32: np.ndarray
    sample_rate: int
    started_ns: int
    ended_ns: int | None
    is_final: bool
    forced_end: bool


@dataclass(frozen=True)
class AsrResult:
    utterance_id: str
    text: str
    source_mode: str
    is_final: bool
    inference_ms: float
    model_id: str
    confidence: float | None


@dataclass(frozen=True)
class TranslationResult:
    utterance_id: str
    source_text: str
    english_text: str
    is_final: bool
    inference_ms: float
    model_id: str
    protected_terms: list[str]
```

## 13. Model Loading

- Verify manifest and checksum before load.
- Avoid `trust_remote_code=True`.
- Prefer safetensors or ONNX.
- Set local-files-only behavior in production.
- Refuse remote downloads from the inference process.
- Warm up with a short synthetic/silent input.
- Report warmup duration and memory.
- Handle CUDA OOM by unloading safely and offering a lower resource profile.

## 14. Quantization

Quantization is accepted only after:

- output parity tests;
- native-speaker review on representative fixtures;
- latency measurement;
- VRAM measurement;
- regression thresholds.

Do not assume a community GGUF conversion is production-safe. Record exact converter, commit, quantization, and checksum.

## 15. Future Quality Work

After V1:

- fine-tune/adapt on consented casual gaming speech;
- train a lightweight punctuation model;
- improve code-switch segmentation;
- optional per-friend vocabulary;
- optional speaker clustering labeled only as Speaker 1/2;
- compare alternative translation checkpoints with permissive licensing.

## 16. AI Failure UX

For an unintelligible utterance:

- do not hallucinate a confident tactical command;
- show source-only when translation fails;
- optionally show `[unclear]`;
- expire quickly;
- count the event in diagnostics.

For very low confidence, prefer omission over misleading specificity.
