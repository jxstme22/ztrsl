# Phase 12 — Installer and Documentation

**Status:** ☑ docs + notices + release criteria complete; clean-machine
installer walkthrough is the final `[WINDOWS]` gate before tagging

## Acceptance criteria (spec §17 Phase 12)

1. THIRD_PARTY_NOTICES is complete and current.
2. VB-CABLE is a documented separate install with a clear handoff page.
3. Docs 17–23 from the spec §18 are written.
4. Installer checks pass on a clean Windows 11 machine.

## Tasks
- [x] THIRD_PARTY_NOTICES update (VB-CABLE references, new deps)
- [x] VB-CABLE handoff docs (install link, what xTRSNLTR does/doesn't do)
- [x] Docs 17–23 (setup, sources, strictness, models, diagnostics, troubleshooting, FAQ)
- [x] `docs/v0_3/RELEASE_CRITERIA.md` all ☑
- [ ] Installer: fresh machine walkthrough, uninstall clean (`[WINDOWS]`)
- [x] Final CI: rust (windows/macos) + python + frontend all green
- [ ] Tag v0.3.0 after evidence review

## Files (expected)
- [x] `docs/17_*.md` … `docs/23_*.md`
- [x] `THIRD_PARTY_NOTICES.md` (or existing notices file) → `NOTICE`

## Evidence policy
Clean-machine install log + screenshots; release criteria checklist fully checked with pointers into phase logs.
