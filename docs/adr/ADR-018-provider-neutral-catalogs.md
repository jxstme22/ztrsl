# ADR-018: Provider-Neutral Model Catalogs

- Status: Accepted
- Date: 2026-08-03
- Owners: Project maintainers

## Context

v0.2 catalogs point at `huggingface.co` only. Users in mainland China and
networks with restricted reach cannot install models, making the app unusable
there. v0.3 must keep the verified-artifact guarantees of ADR-004 (checksums,
licenses) while allowing alternate providers, mirrors, and offline delivery.

## Decision

- The model catalog becomes provider-neutral: each catalog entry lists one or
  more providers (e.g. `huggingface`, `modelscope`, `hf-mirror`, `local`) with
  per-provider artifact references. Selection order and probing/failover
  follow the spec §10 provider lists.
- Custom mirror support from v0.2 (`LST_HF_ENDPOINT` / in-app endpoint,
  `models_download_endpoint`/`models_set_download_endpoint`) is preserved and
  composes with provider lists (a custom endpoint is a provider entry).
- Signed catalogs: catalog files carry a signature over their contents; the app
  verifies before use (rolls into ADR-004's checksum + license guarantees).
- Offline packs: a directory of already-downloaded, manifest-verified
  artifacts can be imported without any network.
- Capability metadata (ADR-016 forced/preferred/post-filter, recommended
  resource profile, VRAM class) ships in the catalog so the UI can be honest
  without probing the model.
- No new telemetry; provider choice stays local.

## Consequences

- Installation works without `huggingface.co` reachable.
- Larger catalog surface to maintain; signatures must be rotated securely.
- All verification guarantees (checksum, license, provenance) still enforced
  at install time for every provider.

## Alternatives Considered

- Static hardcoded mirrors list: rejected — fails the signature/verification
  model and can't adapt.
- Skip verification for non-HF providers: rejected — violates ADR-004.

## Evidence and Review Trigger

- Phase 9: provider failover test with unreachable HF; offline-pack install
  test; corrupted-signature rejection test.
- Release criteria: "huggingface.co entirely unreachable, models still install".
