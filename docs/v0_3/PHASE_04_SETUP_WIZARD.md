# Phase 4 — VB-CABLE and Source Setup Wizard

**Status:** ☑ complete (11-step wizard in `apps/desktop/src/setup/`, committed `73eea86`; 128 desktop tests passing)

## Acceptance criteria (spec §17 Phase 4)

1. VB-CABLE presence is detected and reported honestly (installed / not installed / disabled).
2. Recommended mode (game → VB-CABLE, headphones → VB-CABLE) and advanced mode (manual endpoint selection) both work.
3. Routing wizard walks the user through wiring with numbered steps, is self-explanatory, and never implies VB-CABLE is bundled.
4. Isolation and monitoring tests are part of the wizard.

## Tasks
- [ ] VB-CABLE detection (`CABLE Input` / `CABLE Output` endpoint presence)
- [ ] Wizard steps 1–11 per spec §5 (speaker, device, cable, game routing, headphones, monitoring, test)
- [ ] Isolation test: game audio must not reach TEAM ASR without the cable
- [ ] Monitoring test: headphone blend optional, never fed to ASR
- [ ] Reuse editable presets (VALORANT Team/Discord/Party Chat/Browser Voice/Custom)
- [ ] Advanced mode: manual endpoint/target selection bypassing recommended layout
- [ ] Unit tests with fake endpoint lists; hardware test tagged

## Files (expected)
- `apps/desktop/src/features/setup/*` wizard UI
- Tauri commands: VB-CABLE detection, isolation test, monitoring test
- `docs/v0_3` evidence: fresh-install walkthrough screenshots

## Evidence policy
Wizard works end-to-end on a machine WITHOUT VB-CABLE (clear guidance, no false claims) and WITH it (recommended mode routes correctly).
