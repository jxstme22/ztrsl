# Phase 9 — Model Manager v2

**Status:** ☐ not started

## Acceptance criteria (spec §17 Phase 9)

1. Catalogs expose capabilities + recommended resource profiles.
2. Providers are lists with probing and failover; Hugging Face unavailability is not fatal.
3. ModelScope and mainland-CN providers work.
4. Signed catalogs and offline packs are supported.
5. Custom `LST_HF_ENDPOINT` mirror choice is preserved.

## Tasks
- [ ] `crates/model-manager/src/provider.rs`: provider registry (huggingface, modelscope, hf-mirror, local)
- [ ] `capabilities.rs`: per-model capabilities (forced/preferred/post-filter, recommended profile, VRAM class)
- [ ] `signed_catalog.rs`: catalog signature verification (checksum chain per ADR-004)
- [ ] `offline_pack.rs`: pre-downloaded pack import
- [ ] `region.rs`: mainland-CN provider selection
- [ ] Probing + failover with honest UI status
- [ ] ModelsPanel v2: source-model mapping for multi-source
- [ ] Preserve DownloadServerRow custom endpoint behavior
- [ ] Tests: failover order, signature rejection, offline import, capability honesty

## Files (expected)
- `crates/model-manager/src/{provider,capabilities,signed_catalog,offline_pack,region}.rs`
- `apps/desktop/src/models/*` v2

## Evidence policy
CI test with network to modelscope.cn simulated by stub provider; offline-pack install test; corrupted signature rejected.
