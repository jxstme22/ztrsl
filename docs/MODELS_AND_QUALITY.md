# Models and quality

Models install from the **Models** page (pinned, checksum-verified).
Every catalog model is available globally with automatic mirror failover
(hf-mirror → modelscope) for mainland-China users.

Quality profiles (Live → Quality):

- **Fast** — 400 ms provisional cadence, 1.5 s final target, 1 model.
- **Balanced** — the default; near-real-time with fallback decode.
- **Best quality** — reduced provisionals, up to 6 s finals.
- **Low memory** — provisionals off, 1 GB budget.

Provider notes: opus-mt (en↔zh) runs dequantized float16 on CUDA; NLLB is
CC-BY-NC (non-commercial); SenseVoice/Paraformer run on CPU via sherpa-onnx.
