# v1.0 release gate (DS-1005)

Release only when every row is verified:

- [ ] No known wrong-language silent fallback remains (DEC-001)
- [ ] Normal supported load has zero raw-audio packet loss
- [ ] A first-time Windows tester completes VB-CABLE setup without external help
- [ ] Saved profiles recover from endpoint changes
- [ ] Final captions cannot be overwritten by stale provisional captions
- [ ] General preset contains no VALORANT-only vocabulary
- [ ] Benchmark results recorded by language and condition
- [ ] Clean-machine installation passes (Windows + Apple Silicon matrices)
- [ ] All canonical verification commands pass
- [ ] Documentation is current (docs/release/* + user docs)

Run `python scripts/check_release_gate.py` for the automated subset.
