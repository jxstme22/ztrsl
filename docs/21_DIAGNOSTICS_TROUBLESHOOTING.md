# 21 — Diagnostics and Troubleshooting

## Diagnostics tab

The **Diagnostics** panel shows live, content-free metrics:

- **Scheduler** — queue depth, queue delay, finals/provisionals completed,
  coalescing rate, drops, overload events.
- **Per-source cards** — packets received, utterances completed, captions
  emitted, dropped utterances, low-confidence count, and the language-filter
  counters (filtered/suppressed/flagged/passed).
- **Isolation check** — confirms no cross-source leakage (game audio never
  appearing in the wrong source's ASR path).
- **Export support bundle** — downloads a JSON archive of metrics + config
  only. It is verified content-free: no transcripts can ever leak into it.

## Common failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| No captions, live session stuck "listening" | Capture endpoint disconnected | Re-select the endpoint; the app errors after ~1.5 s of silence |
| One source stopped but others fine | That source's VAD/capture isolated failure | Check its source card; restart just that source |
| Strict mode drops real speech | Decoder not hard-locked (post-filter) | Switch to Balanced or a fixed-language model |
| English callouts missing under Strict | Over-aggressive filter | They should pass via the tactical glossary; if not, file a bug |
| Models won't download | `huggingface.co` unreachable | Set a mirror or `LST_REGION=cn`, or import an offline pack |
| Overlay shows two lanes but you want one | Simultaneous policy | Settings → Overlay → Newest wins / Primary wins |

## Support data

When reporting an issue, use **Export support bundle** from Diagnostics and
attach the JSON — it contains metrics and config but never any transcript or
audio content.
