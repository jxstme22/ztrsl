# Clean-machine matrix — Windows (DS-1000)

Record exact results for every row on a fresh Windows 11 x64 VM, in order.

| Scenario | Result | Notes |
|---|---|---|
| No CUDA toolkit, CPU only | ☐ | ASR/MT run on CPU; latency within balanced budget |
| NVIDIA GPU, no toolkit | ☐ | GPU runtime pack downloads, CUDA detection green |
| NVIDIA GPU, CUDA 12 toolkit | ☐ | Pack not re-downloaded; live shows cuda/float16 |
| CPU-only, 4 cores | ☐ | Balanced profile remains responsive |
| VB-CABLE absent | ☐ | Detection card says "not detected" with routing guide |
| VB-CABLE installed before app | ☐ | Detection green; capture from CABLE Output works |
| VB-CABLE installed while app open | ☐ | Refresh devices discovers it without restart |
| Missing model | ☐ | Live start shows a clear install prompt |
| Corrupt model | ☐ | Install fails checksum; partial files cleaned |
| Disconnected endpoint | ☐ | Source health reports disconnected + recovery action |
| Renamed endpoint | ☐ | Recovery suggests replacement without recreating |
| Multiple virtual cables | ☐ | Both pairs listed; user picks |
| Overload (many sources) | ☐ | Provisionals suppressed, finals preserved, warning |
