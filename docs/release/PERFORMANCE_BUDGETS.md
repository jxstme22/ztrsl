# Performance budgets (DS-1003)

Authoritative copy: `services/inference/src/local_squad_inference/performance_budgets.py`.

| Quality | Provisional cadence | Final latency target | Queue capacity | Concurrent sources | Loaded models | Memory |
|---|---|---|---|---|---|---|
| fast | 400 ms | 1.5 s | 4 | 4 | 1 | 2 GB |
| balanced | 600 ms | 3.0 s | 6 | 4 | 2 | 4 GB |
| best_quality | 1000 ms | 6.0 s | 8 | 2 | 2 | 8 GB |
| low_memory | 1200 ms | 5.0 s | 4 | 2 | 1 | 1 GB |

Selections outside the class surface deterministic warnings (never blocks).
