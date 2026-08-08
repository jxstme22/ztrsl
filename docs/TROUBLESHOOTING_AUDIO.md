# Troubleshooting audio

| Symptom | Fix |
|---|---|
| "Audio endpoint is in exclusive use" | The game/voice app holds the device; use CABLE Output (virtual) instead |
| No captions, health shows `silent` | Check the app routes to CABLE Input; refresh devices |
| Captions for game sounds | Route game music to headphones, never the cable; rerun isolation test |
| Monitoring echo | Monitoring must not route back into the cable (validation blocks it) |
| Endpoint disappeared | Device unplugged/renamed: Sources → recovery replaces the endpoint |
| Everything lags | Lower Quality profile or fewer concurrent sources |

Full failure→recovery table: `docs/release/RECOVERY_STATES.md`.
