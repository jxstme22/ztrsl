# Executive Summary

## Product

A Windows desktop application that translates incoming VALORANT voice communication from Tagalog/Filipino and Cebuano into English subtitles in real time.

## User Story

> While playing VALORANT with friends who speak Tagalog or Cebuano, I want English subtitles over the game so I can understand tactical calls without sending audio to a cloud service.

## Why the Architecture Is Cascaded

The project requires:

- access to the source transcript for debugging and correction;
- support for Cebuano, which has weaker coverage in many general speech systems;
- terminology protection for map locations, agents, weapons, and gaming slang;
- separate latency control for speech recognition and translation;
- a practical way to improve final captions without delaying all provisional output.

Therefore:

```mermaid
flowchart LR
  A[Voice-chat audio endpoint] --> B[VAD and utterance manager]
  B --> C[ASR]
  C --> D[Transcript stabilization]
  D --> E[Terminology protection]
  E --> F[Machine translation]
  F --> G[Subtitle lifecycle]
  G --> H[External overlay]
```

## V1 Audio Strategy

Route VALORANT voice-chat output to a signed, user-installed virtual audio cable. The app captures that endpoint and forwards it to the user's physical headphones while also feeding a mono 16 kHz copy to the local inference service.

Reasons:

- it isolates voice chat better than capturing the full game mix;
- it avoids touching the game process;
- it is understandable and testable;
- it avoids developing and distributing a driver in V1.

A process-specific loopback experiment may be retained as a fallback research branch, but it will probably contain the complete game process audio rather than only voice chat.

## V1 AI Strategy

```text
Silero VAD
→ Omnilingual ASR CTC 300M int8
→ transcript stabilization
→ VALORANT glossary and protected terms
→ MADLAD-400 3B MT
→ English subtitles
```

The 1B ASR checkpoint is benchmark-gated. The game owns resource priority. Larger models are not automatically better if they introduce frame-time spikes or subtitle delay.

## Key UX

The overlay must show:

- optional smaller source transcript;
- prominent English translation;
- provisional visual state;
- final visual state;
- connection/model status outside active gameplay;
- a global toggle;
- font size and position controls.

The overlay must not:

- steal keyboard or mouse focus;
- mimic official VALORANT UI;
- display tactical information extracted from the game;
- obstruct critical HUD areas by default.

## Main Risks

1. Cebuano conversational accuracy.
2. Code-switching with English gaming terms.
3. Virtual-device setup complexity.
4. Audio-forwarding echo or latency.
5. GPU contention with VALORANT.
6. Overlay behavior across display modes and monitor setups.
7. Third-party product policy and anti-cheat perception.
8. Distribution size and model licensing.

## Delivery Strategy

- Phase 0: repo and diagnostics.
- Phase 1: overlay only.
- Phase 2: endpoint enumeration and audio meter.
- Phase 3: capture + monitor routing.
- Phase 4: VAD and utterance segmentation.
- Phase 5: fake ASR/translation vertical slice.
- Phase 6: real ASR.
- Phase 7: real translation.
- Phase 8: latency stabilization.
- Phase 9: in-game validation.
- Phase 10: packaging and model manager.
- Phase 11: native-runtime optimization only if justified.

## Success Criteria

A successful personal V1:

- works in Borderless Windowed mode;
- translates finalized utterances locally;
- maintains acceptable game performance;
- survives device changes and model errors;
- does not persist raw audio by default;
- provides measured rather than assumed quality.

See `15_ACCEPTANCE_CHECKLIST.md` for binding criteria.
